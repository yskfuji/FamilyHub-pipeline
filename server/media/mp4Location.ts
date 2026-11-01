import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/**
 * MP4・MOV の中の撮影場所の情報を、ファイルの長さを変えずに消す。
 * 対象は udta の ©xyz と loci、および meta の keys に location を含む項目。
 * 構造を読み切れないときは例外にする。呼び出し側は保存せずに拒否する（残したまま保存しない）。
 */
const MAX_BOX_READ = 256 * 1024 * 1024;
const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta']);
const LOCATION_TYPES = new Set(['©xyz', 'loci']);

interface Box { type: string; start: number; headerSize: number; size: number }

async function readBox(file: FileHandle, offset: number, limit: number): Promise<Box | null> {
  if (offset + 8 > limit) return null;
  const header = Buffer.alloc(16);
  await file.read(header, 0, 16, offset);
  let size = header.readUInt32BE(0);
  const type = header.toString('latin1', 4, 8);
  let headerSize = 8;
  if (size === 1) { size = Number(header.readBigUInt64BE(8)); headerSize = 16; }
  else if (size === 0) size = limit - offset;
  if (size < headerSize || offset + size > limit) throw new Error('malformed box');
  return { type, start: offset, headerSize, size };
}

async function blank(file: FileHandle, box: Box) {
  const payload = box.size - box.headerSize;
  await file.write(Buffer.alloc(payload), 0, payload, box.start + box.headerSize);
  // 種類の名前も消し、読み手が無視する free にする。
  await file.write(Buffer.from('free', 'latin1'), 0, 4, box.start + 4);
}

/** meta の keys から location の番号を探し、ilst の対応する値を消す。 */
async function scrubMeta(file: FileHandle, meta: Box) {
  let cursor = meta.start + meta.headerSize;
  const end = meta.start + meta.size;
  // QuickTime の meta には version と flags がなく、ISO の meta にはある。
  const peek = Buffer.alloc(8);
  await file.read(peek, 0, 8, cursor);
  if (peek.toString('latin1', 4, 8) !== 'hdlr') cursor += 4;
  const locations = new Set<number>();
  let ilst: Box | null = null;
  for (let box = await readBox(file, cursor, end); box; box = await readBox(file, box.start + box.size, end)) {
    if (box.type === 'keys') {
      if (box.size > MAX_BOX_READ) throw new Error('keys box too large');
      const body = Buffer.alloc(box.size - box.headerSize);
      await file.read(body, 0, body.length, box.start + box.headerSize);
      let at = 8;
      for (let index = 1, count = body.readUInt32BE(4); index <= count; index += 1) {
        const size = body.readUInt32BE(at);
        if (size < 8 || at + size > body.length) throw new Error('malformed keys box');
        if (body.toString('latin1', at + 8, at + size).toLowerCase().includes('location')) { locations.add(index); body.fill(0, at + 8, at + size); }
        at += size;
      }
      if (locations.size) await file.write(body, 0, body.length, box.start + box.headerSize);
    } else if (box.type === 'ilst') ilst = box;
  }
  if (!ilst || !locations.size) return;
  const stop = ilst.start + ilst.size;
  for (let item = await readBox(file, ilst.start + ilst.headerSize, stop); item; item = await readBox(file, item.start + item.size, stop)) {
    if (locations.has(Buffer.from(item.type, 'latin1').readUInt32BE(0))) await file.write(Buffer.alloc(item.size - item.headerSize), 0, item.size - item.headerSize, item.start + item.headerSize);
  }
}

async function walk(file: FileHandle, from: number, to: number): Promise<number> {
  let removed = 0;
  for (let box = await readBox(file, from, to); box; box = await readBox(file, box.start + box.size, to)) {
    if (LOCATION_TYPES.has(box.type)) { await blank(file, box); removed += 1; }
    else if (box.type === 'meta') await scrubMeta(file, box);
    else if (containers.has(box.type)) removed += await walk(file, box.start + box.headerSize, box.start + box.size);
  }
  return removed;
}

export async function stripVideoLocation(path: string) {
  const file = await open(path, 'r+');
  try {
    const { size } = await file.stat();
    return await walk(file, 0, size);
  } finally {
    await file.close();
  }
}
