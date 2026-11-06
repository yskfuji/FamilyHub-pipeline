import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { captureTimeFromMvhd, captureTimeFromQuickTime } from '../../src/domain/captureTime';
import type { CaptureTime } from '../../src/domain/captureTime';

/**
 * MP4・MOV のメタデータ（A15・A16）。
 *
 * 読む: 撮影日時。com.apple.quicktime.creationdate（時差つき）を優先し、なければ mvhd の creation_time。
 *
 * 消す: 許可した項目のほかのメタデータを、ファイルの長さを変えずに空にする（箱の種類を free にし、中身を 0 にする）。
 * 許可するのは作成日時（©day・com.apple.quicktime.creationdate）と、位置を残すときだけ位置（©xyz・loci・com.apple.quicktime.location.*）。
 * 対象は udta と meta（moov・トラック・最上位のどこでも）、XMP などの uuid、最上位の知らない箱、
 * 時刻つきメタデータのトラック（gpmd・camm・mebx など。サンプルの中身を 0 にする）。
 * 構造を読み切れないとき、扱えないもの（圧縮した moov、断片に分けたファイルのメタデータのトラック、stz2）があるときは
 * VideoMetadataError を投げる。呼び出し側は保存せずに拒否する（残したまま保存しない）。
 */
export class VideoMetadataError extends Error {}
/** 読めたが、空にする方法を持たないメタデータ（圧縮した moov など）。 */
export class UnsupportedVideoMetadata extends VideoMetadataError {}

const MAX_LEAF = 64 * 1024 * 1024;
const MAX_BOXES = 200_000;
const MAX_SAMPLES = 20_000_000;

/** 最上位で、そのまま残す箱。ほかの最上位の箱は、知らないメタデータとして空にする。 */
const TOP_LEVEL_KEPT = new Set(['ftyp', 'moov', 'mdat', 'moof', 'mfra', 'sidx', 'ssix', 'styp', 'prft', 'emsg', 'pdin']);
/** 中をたどる箱。 */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf', 'mfra']);
/** 空けておくだけの箱。中に古いメタデータが残っていることがあるので 0 にする。 */
const PADDING = new Set(['free', 'skip', 'wide']);
/** 時刻つきメタデータのトラックの、サンプルの形式とハンドラー。 */
const TIMED_METADATA_FORMATS = new Set(['gpmd', 'camm', 'mebx', 'rtmd', 'fdsc']);
const TIMED_METADATA_HANDLERS = new Set(['meta', 'camm']);

const CREATION_KEY = 'com.apple.quicktime.creationdate';
const LOCATION_KEY_PREFIX = 'com.apple.quicktime.location.';

interface Box { type: string; start: number; headerSize: number; size: number }
const end = (box: Box) => box.start + box.size;
const bodyStart = (box: Box) => box.start + box.headerSize;

class Walker {
  private boxes = 0;
  constructor(readonly file: FileHandle, readonly size: number) {}

  async readBox(offset: number, limit: number): Promise<Box | null> {
    if (offset === limit) return null;
    if (offset + 8 > limit) {
      // QuickTime の udta などは、末尾に 0 の4バイトを置いてよい。0 でなければ箱ではない。
      const rest = Buffer.alloc(limit - offset);
      await this.file.read(rest, 0, rest.length, offset);
      if (rest.every((byte) => byte === 0)) return null;
      throw new VideoMetadataError('trailing bytes that are not a box');
    }
    if ((this.boxes += 1) > MAX_BOXES) throw new VideoMetadataError('too many boxes');
    const header = Buffer.alloc(16);
    await this.file.read(header, 0, 16, offset);
    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let headerSize = 8;
    if (size === 1) { size = Number(header.readBigUInt64BE(8)); headerSize = 16; }
    else if (size === 0) size = limit - offset;
    if (size < headerSize || offset + size > limit) throw new VideoMetadataError(`malformed box ${JSON.stringify(type)}`);
    return { type, start: offset, headerSize, size };
  }

  async children(from: number, to: number): Promise<Box[]> {
    const list: Box[] = [];
    for (let box = await this.readBox(from, to); box; box = await this.readBox(end(box), to)) list.push(box);
    return list;
  }

  async body(box: Box, max = MAX_LEAF): Promise<Buffer> {
    const length = box.size - box.headerSize;
    if (length > max) throw new VideoMetadataError(`${box.type} box too large`);
    const buffer = Buffer.alloc(length);
    await this.file.read(buffer, 0, length, bodyStart(box));
    return buffer;
  }

  async zero(from: number, length: number) {
    if (from < 0 || length < 0 || from + length > this.size) throw new VideoMetadataError('range outside the file');
    const block = Buffer.alloc(Math.min(length, 1024 * 1024));
    for (let done = 0; done < length; done += block.length) await this.file.write(block, 0, Math.min(block.length, length - done), from + done);
  }

  /** 箱の中身を 0 にし、種類を free にする。読み手は無視する。 */
  async blank(box: Box) {
    await this.zero(bodyStart(box), box.size - box.headerSize);
    await this.file.write(Buffer.from('free', 'latin1'), 0, 4, box.start + 4);
  }
}

/** QuickTime の meta には version と flags がなく、ISO の meta にはある。中の最初の箱の位置。 */
async function metaChildrenStart(walker: Walker, meta: Box) {
  const peek = Buffer.alloc(8);
  await walker.file.read(peek, 0, 8, bodyStart(meta));
  return peek.toString('latin1', 4, 8) === 'hdlr' ? bodyStart(meta) : bodyStart(meta) + 4;
}

interface KeyEntry { index: number; name: string; nameStart: number; nameLength: number }

function parseKeys(body: Buffer, keysBodyStart: number): KeyEntry[] {
  if (body.length < 8) throw new VideoMetadataError('malformed keys box');
  const entries: KeyEntry[] = [];
  let at = 8;
  const count = body.readUInt32BE(4);
  if (count > 100_000) throw new VideoMetadataError('too many keys');
  for (let index = 1; index <= count; index += 1) {
    if (at + 8 > body.length) throw new VideoMetadataError('malformed keys box');
    const size = body.readUInt32BE(at);
    if (size < 8 || at + size > body.length) throw new VideoMetadataError('malformed keys box');
    entries.push({ index, name: body.toString('latin1', at + 8, at + size), nameStart: keysBodyStart + at + 8, nameLength: size - 8 });
    at += size;
  }
  return entries;
}

/** ilst の項目の中の、最初の data の値（type indicator と locale の後ろ）。 */
async function itemValue(walker: Walker, item: Box): Promise<Buffer | null> {
  for (const child of await walker.children(bodyStart(item), end(item))) {
    if (child.type !== 'data') continue;
    const body = await walker.body(child, 4096);
    return body.length >= 8 ? body.subarray(8) : null;
  }
  return null;
}

/* ---------- 撮影日時 ---------- */

async function quickTimeCreationDate(walker: Walker, meta: Box): Promise<string | null> {
  const parts = await walker.children(await metaChildrenStart(walker, meta), end(meta));
  const keysBox = parts.find((box) => box.type === 'keys');
  const ilst = parts.find((box) => box.type === 'ilst');
  if (!keysBox || !ilst) return null;
  const key = parseKeys(await walker.body(keysBox), bodyStart(keysBox)).find((entry) => entry.name === CREATION_KEY);
  if (!key) return null;
  for (const item of await walker.children(bodyStart(ilst), end(ilst))) {
    if (Buffer.from(item.type, 'latin1').readUInt32BE(0) !== key.index) continue;
    const value = await itemValue(walker, item);
    return value ? value.toString('utf8') : null;
  }
  return null;
}

/** 撮影日時を読む。メタデータを消す前に呼ぶ。読めなければ null（構造が壊れていれば VideoMetadataError）。 */
export async function readVideoCaptureTime(path: string, timeZone: string, now: Date): Promise<CaptureTime | null> {
  const file = await open(path, 'r');
  try {
    const walker = new Walker(file, (await file.stat()).size);
    const moov = (await walker.children(0, walker.size)).find((box) => box.type === 'moov');
    if (!moov) return null;
    let mvhdSeconds: number | null = null;
    const metas: Box[] = [];
    for (const child of await walker.children(bodyStart(moov), end(moov))) {
      if (child.type === 'mvhd') {
        const body = await walker.body(child, 1024);
        if (body.length >= 12 && body[0] === 0) mvhdSeconds = body.readUInt32BE(4);
        else if (body.length >= 20 && body[0] === 1) { const value = body.readBigUInt64BE(4); mvhdSeconds = value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value); }
      } else if (child.type === 'meta') metas.push(child);
      else if (child.type === 'udta') metas.push(...(await walker.children(bodyStart(child), end(child))).filter((box) => box.type === 'meta'));
    }
    for (const meta of metas) {
      const value = await quickTimeCreationDate(walker, meta);
      const parsed = value ? captureTimeFromQuickTime(value, now) : null;
      if (parsed) return parsed;
    }
    return mvhdSeconds === null ? null : captureTimeFromMvhd(mvhdSeconds, timeZone, now);
  } finally {
    await file.close();
  }
}

/* ---------- メタデータを空にする ---------- */

export interface ScrubResult { blanked: number; blankedSamples: number }

class Scrubber {
  blanked = 0;
  blankedSamples = 0;
  /** 0 にしたサンプルのバイト数の合計（全部のトラック）。 */
  private zeroedBytes = 0;
  fragmented = false;
  constructor(readonly walker: Walker, readonly keepLocation: boolean) {}

  private allowedAtom(type: string) { return type === '©day' || (this.keepLocation && (type === '©xyz' || type === 'loci')); }
  private allowedKey(name: string) { return name === CREATION_KEY || (this.keepLocation && name.startsWith(LOCATION_KEY_PREFIX)); }

  private async blank(box: Box) { await this.walker.blank(box); this.blanked += 1; }

  /** ilst の項目を空にする。中身は、読み手が飛ばせる free の箱にする。 */
  private async blankItem(item: Box) {
    const length = item.size - item.headerSize;
    await this.walker.zero(bodyStart(item), length);
    if (length >= 8) {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(length, 0);
      header.write('free', 4, 'latin1');
      await this.walker.file.write(header, 0, 8, bodyStart(item));
    }
    this.blanked += 1;
  }

  async top() {
    const boxes = await this.walker.children(0, this.walker.size);
    this.fragmented = boxes.some((box) => box.type === 'moof');
    for (const box of boxes) {
      if (box.type === 'udta') await this.udta(box);
      else if (box.type === 'meta') await this.meta(box);
      else if (PADDING.has(box.type)) await this.walker.zero(bodyStart(box), box.size - box.headerSize);
      else if (CONTAINERS.has(box.type)) await this.container(box);
      else if (!TOP_LEVEL_KEPT.has(box.type)) await this.blank(box);
    }
  }

  private async container(box: Box) {
    for (const child of await this.walker.children(bodyStart(box), end(box))) {
      if (child.type === 'cmov') throw new UnsupportedVideoMetadata('compressed movie header');
      if (child.type === 'udta') await this.udta(child);
      else if (child.type === 'meta') await this.meta(child);
      else if (child.type === 'uuid' || PADDING.has(child.type)) await this.blank(child);
      else if (child.type === 'trak') await this.track(child);
      else if (CONTAINERS.has(child.type)) await this.container(child);
    }
  }

  private async udta(box: Box) {
    for (const child of await this.walker.children(bodyStart(box), end(box))) {
      if (child.type === 'meta') await this.meta(child);
      else if (!this.allowedAtom(child.type)) await this.blank(child);
    }
  }

  private async meta(box: Box) {
    const parts = await this.walker.children(await metaChildrenStart(this.walker, box), end(box));
    const keysBox = parts.find((part) => part.type === 'keys');
    let allowedIndexes: Set<number> | null = null;
    if (keysBox) {
      const keys = parseKeys(await this.walker.body(keysBox), bodyStart(keysBox));
      allowedIndexes = new Set(keys.filter((key) => this.allowedKey(key.name)).map((key) => key.index));
      for (const key of keys) if (!allowedIndexes.has(key.index)) await this.walker.zero(key.nameStart, key.nameLength);
    }
    for (const part of parts) {
      if (part.type === 'hdlr' || part.type === 'keys') continue;
      if (part.type !== 'ilst') { await this.blank(part); continue; }
      for (const item of await this.walker.children(bodyStart(part), end(part))) {
        const allowed = allowedIndexes ? allowedIndexes.has(Buffer.from(item.type, 'latin1').readUInt32BE(0)) : this.allowedAtom(item.type);
        if (!allowed) await this.blankItem(item);
      }
    }
  }

  private async track(trak: Box) {
    const mdia = (await this.walker.children(bodyStart(trak), end(trak))).find((box) => box.type === 'mdia');
    const mdiaChildren = mdia ? await this.walker.children(bodyStart(mdia), end(mdia)) : [];
    const hdlr = mdiaChildren.find((box) => box.type === 'hdlr');
    const handler = hdlr ? (await this.walker.body(hdlr, 4096)).toString('latin1', 8, 12) : '';
    const minf = mdiaChildren.find((box) => box.type === 'minf');
    const stbl = minf ? (await this.walker.children(bodyStart(minf), end(minf))).find((box) => box.type === 'stbl') : undefined;
    const tables = stbl ? await this.walker.children(bodyStart(stbl), end(stbl)) : [];
    const stsd = tables.find((box) => box.type === 'stsd');
    const format = stsd ? (await this.walker.body(stsd, 1024 * 1024)).toString('latin1', 12, 16) : '';
    if (TIMED_METADATA_HANDLERS.has(handler) || TIMED_METADATA_FORMATS.has(format)) {
      if (this.fragmented) throw new UnsupportedVideoMetadata(`timed metadata track (${format || handler}) in a fragmented file`);
      await this.blankSamples(tables);
    }
    await this.container(trak);
  }

  /** トラックのサンプルの位置を表から求め、中身を 0 にする。 */
  private async blankSamples(tables: Box[]) {
    const find = (type: string) => tables.find((box) => box.type === type);
    if (find('stz2')) throw new UnsupportedVideoMetadata('compact sample sizes in a timed metadata track');
    const stszBox = find('stsz');
    const stscBox = find('stsc');
    const offsetsBox = find('stco') ?? find('co64');
    if (!stszBox || !stscBox || !offsetsBox) throw new VideoMetadataError('timed metadata track without sample tables');
    const stsz = await this.walker.body(stszBox);
    const stsc = await this.walker.body(stscBox);
    const offsets = await this.walker.body(offsetsBox);
    if (stsz.length < 12 || stsc.length < 8 || offsets.length < 8) throw new VideoMetadataError('malformed sample tables');
    const fixedSize = stsz.readUInt32BE(4);
    const sampleCount = stsz.readUInt32BE(8);
    if (sampleCount > MAX_SAMPLES || (fixedSize === 0 && stsz.length < 12 + sampleCount * 4)) throw new VideoMetadataError('malformed stsz');
    const sizeOf = (index: number) => (fixedSize !== 0 ? fixedSize : stsz.readUInt32BE(12 + index * 4));
    const wide = offsetsBox.type === 'co64';
    const chunkCount = offsets.readUInt32BE(4);
    if (offsets.length < 8 + chunkCount * (wide ? 8 : 4)) throw new VideoMetadataError('malformed chunk offsets');
    // どのチャンクにも1つ以上のサンプルがあるので、チャンクはサンプルより多くならない。
    if (chunkCount > sampleCount) throw new VideoMetadataError('more chunks than samples');
    const chunkOffset = (index: number) => (wide ? Number(offsets.readBigUInt64BE(8 + index * 8)) : offsets.readUInt32BE(8 + index * 4));
    const runs = stsc.readUInt32BE(4);
    if (stsc.length < 8 + runs * 12) throw new VideoMetadataError('malformed stsc');
    let sample = 0;
    for (let run = 0; run < runs; run += 1) {
      const firstChunk = stsc.readUInt32BE(8 + run * 12);
      const perChunk = stsc.readUInt32BE(12 + run * 12);
      const nextFirst = run + 1 < runs ? stsc.readUInt32BE(8 + (run + 1) * 12) : chunkCount + 1;
      if (firstChunk < 1 || nextFirst < firstChunk || nextFirst > chunkCount + 1) throw new VideoMetadataError('malformed stsc');
      for (let chunk = firstChunk; chunk < nextFirst; chunk += 1) {
        const at = chunkOffset(chunk - 1);
        let length = 0;
        for (let index = 0; index < perChunk && sample < sampleCount; index += 1, sample += 1) length += sizeOf(sample);
        if (!Number.isSafeInteger(at) || at + length > this.walker.size) throw new VideoMetadataError('sample outside the file');
        // 正しいファイルではサンプルの範囲は重ならないので、0 にする合計はファイルの長さを超えない。
        // 同じ範囲を何度も指す表で、小さなファイルから際限なく書かせる攻撃を止める（侵入試験 PT-MP4、docs/security/pentest-2026-11.md）。
        this.zeroedBytes += length;
        if (this.zeroedBytes > this.walker.size) throw new VideoMetadataError('sample ranges overlap');
        await this.walker.zero(at, length);
      }
    }
    if (sample !== sampleCount) throw new VideoMetadataError('sample tables disagree');
    this.blankedSamples += sampleCount;
  }
}

/** 許可した項目のほかのメタデータを空にする。ファイルの長さは変えない。 */
export async function scrubVideoMetadata(path: string, options: { keepLocation: boolean }): Promise<ScrubResult> {
  const file = await open(path, 'r+');
  try {
    const scrubber = new Scrubber(new Walker(file, (await file.stat()).size), options.keepLocation);
    await scrubber.top();
    return { blanked: scrubber.blanked, blankedSamples: scrubber.blankedSamples };
  } finally {
    await file.close();
  }
}
