/**
 * 写真に記録された GPS 位置だけを読む、最小限の EXIF 解析器（JPEG / HEIF）。
 * 入力は信頼できないバイト列として扱う。読む範囲・ループ回数・参照先をすべて制限し、例外を外へ出さない。
 */

import { Malformed, MAX_IFD_ENTRIES, Reader, readGpsFromTiff } from '../../domain/exifTiff';
import type { PhotoGpsOutcome } from '../../domain/exifTiff';

export type { GpsReading, PhotoGpsOutcome } from '../../domain/exifTiff';
export { readGpsFromTiff } from '../../domain/exifTiff';

type ExifLocation =
  | { kind: 'inline'; tiffOffset: number; tiffEnd: number }
  | { kind: 'range'; fileOffset: number; length: number }
  | null;

export const PHOTO_MAX_BYTES = 30 * 1024 * 1024;
export const HEAD_BYTES = 256 * 1024;
export const EXIF_ITEM_MAX_BYTES = 128 * 1024;
const MAX_JPEG_MARKERS = 64;
const MAX_BOXES = 256;
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1', 'avif']);

/* ---------- JPEG / HEIF: EXIF の場所を探す ---------- */

function locateJpegExif(reader: Reader): ExifLocation {
  let offset = 2;
  for (let markers = 0; markers < MAX_JPEG_MARKERS; markers += 1) {
    if (offset + 4 > reader.length) return null;
    if (reader.u8(offset) !== 0xff) throw new Malformed();
    let marker = reader.u8(offset + 1);
    while (marker === 0xff) { offset += 1; marker = reader.u8(offset + 1); }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS: 以降に EXIF はない
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = reader.u16(offset + 2);
    if (length < 2) throw new Malformed();
    const dataStart = offset + 4;
    const end = offset + 2 + length;
    // APP1 には XMP も入る。"Exif\0\0" で始まるものだけを対象にする。
    if (marker === 0xe1 && length >= 16 && dataStart + 6 <= reader.length && reader.ascii(dataStart, 4) === 'Exif' && reader.u8(dataStart + 4) === 0 && reader.u8(dataStart + 5) === 0) {
      return { kind: 'inline', tiffOffset: dataStart + 6, tiffEnd: Math.min(end, reader.length) };
    }
    offset = end;
  }
  return null;
}

interface Box { type: string; start: number; contentStart: number; end: number }

function readBoxes(reader: Reader, start: number, end: number, counter: { boxes: number }): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    if ((counter.boxes += 1) > MAX_BOXES) throw new Malformed();
    let size = reader.u32(offset);
    const type = reader.ascii(offset + 4, 4);
    let header = 8;
    if (size === 1) { size = reader.u64(offset + 8); header = 16; }
    else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) {
      // 先頭部分だけを読んでいるため、末尾が切れている箱は「ここまで」で打ち切る。
      boxes.push({ type, start: offset, contentStart: offset + header, end });
      break;
    }
    boxes.push({ type, start: offset, contentStart: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function locateHeifExif(reader: Reader): ExifLocation {
  const counter = { boxes: 0 };
  const top = readBoxes(reader, 0, reader.length, counter);
  const ftyp = top[0];
  if (!ftyp || ftyp.type !== 'ftyp') return null;
  const brands = [reader.ascii(ftyp.contentStart, 4)];
  for (let offset = ftyp.contentStart + 8; offset + 4 <= ftyp.end && brands.length < 64; offset += 4) brands.push(reader.ascii(offset, 4));
  if (!brands.some((brand) => HEIF_BRANDS.has(brand))) return null;
  const meta = top.find((box) => box.type === 'meta');
  if (!meta) return null;
  // 箱の階層は ftyp/meta → iinf・iloc → infe の3段だけを固定でたどる。
  const children = readBoxes(reader, meta.contentStart + 4, meta.end, counter); // meta は FullBox
  const iinf = children.find((box) => box.type === 'iinf');
  const iloc = children.find((box) => box.type === 'iloc');
  if (!iinf || !iloc) return null;

  const iinfVersion = reader.u8(iinf.contentStart);
  const infeStart = iinf.contentStart + 4 + (iinfVersion === 0 ? 2 : 4);
  let exifItemId: number | null = null;
  for (const infe of readBoxes(reader, infeStart, iinf.end, counter)) {
    if (infe.type !== 'infe') continue;
    const version = reader.u8(infe.contentStart);
    if (version < 2) continue;
    const idSize = version === 2 ? 2 : 4;
    const itemId = idSize === 2 ? reader.u16(infe.contentStart + 4) : reader.u32(infe.contentStart + 4);
    const itemType = reader.ascii(infe.contentStart + 4 + idSize + 2, 4);
    if (itemType === 'Exif') { exifItemId = itemId; break; }
  }
  if (exifItemId === null) return null;

  const version = reader.u8(iloc.contentStart);
  if (version > 2) throw new Malformed();
  let offset = iloc.contentStart + 4;
  const sizes = reader.u8(offset);
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 0x0f;
  const sizes2 = reader.u8(offset + 1);
  const baseOffsetSize = sizes2 >> 4;
  const indexSize = version > 0 ? sizes2 & 0x0f : 0;
  offset += 2;
  const itemCount = version < 2 ? reader.u16(offset) : reader.u32(offset);
  offset += version < 2 ? 2 : 4;
  if (itemCount > MAX_IFD_ENTRIES) throw new Malformed();
  for (let item = 0; item < itemCount; item += 1) {
    const itemId = version < 2 ? reader.u16(offset) : reader.u32(offset);
    offset += version < 2 ? 2 : 4;
    let constructionMethod = 0;
    if (version > 0) { constructionMethod = reader.u16(offset) & 0x0f; offset += 2; }
    offset += 2; // data_reference_index
    const baseOffset = reader.uint(offset, baseOffsetSize);
    offset += baseOffsetSize;
    const extentCount = reader.u16(offset);
    offset += 2;
    if (extentCount > MAX_IFD_ENTRIES) throw new Malformed();
    let first: { offset: number; length: number } | null = null;
    for (let extent = 0; extent < extentCount; extent += 1) {
      offset += indexSize;
      const extentOffset = reader.uint(offset, offsetSize);
      offset += offsetSize;
      const extentLength = reader.uint(offset, lengthSize);
      offset += lengthSize;
      first ??= { offset: extentOffset, length: extentLength };
    }
    if (itemId !== exifItemId) continue;
    if (constructionMethod !== 0 || !first) return null; // ファイル内の位置以外（idat など）は扱わない
    const fileOffset = baseOffset + first.offset;
    if (!Number.isSafeInteger(fileOffset)) throw new Malformed();
    return { kind: 'range', fileOffset, length: first.length };
  }
  return null;
}

function locateExif(head: ArrayBuffer): { format: 'jpeg' | 'heif' | 'unknown'; exif: ExifLocation } {
  const reader = new Reader(head);
  if (reader.length >= 3 && reader.u8(0) === 0xff && reader.u8(1) === 0xd8 && reader.u8(2) === 0xff) return { format: 'jpeg', exif: locateJpegExif(reader) };
  if (reader.length >= 12 && reader.ascii(4, 4) === 'ftyp') return { format: 'heif', exif: locateHeifExif(reader) };
  return { format: 'unknown', exif: null };
}

/* ---------- ファイル全体 ---------- */

const acceptsFile = (file: Blob & { name?: string }) => file.type.startsWith('image/') || (file.type === '' && /\.(jpe?g|heic|heif)$/i.test(file.name ?? ''));

/** 写真の先頭だけを読み、GPS 位置を返す。写真そのものはどこにも送らない。 */
export async function readPhotoGps(file: Blob & { name?: string }): Promise<PhotoGpsOutcome> {
  if (!acceptsFile(file)) return { status: 'unsupported' };
  if (file.size > PHOTO_MAX_BYTES) return { status: 'too-large' };
  try {
    const head = await file.slice(0, HEAD_BYTES).arrayBuffer();
    const { format, exif } = locateExif(head);
    if (format === 'unknown') return { status: 'unsupported' };
    if (!exif) return { status: 'no-gps' };
    if (exif.kind === 'inline') return readGpsFromTiff(head, exif.tiffOffset, exif.tiffEnd);
    const length = Math.min(exif.length || EXIF_ITEM_MAX_BYTES, EXIF_ITEM_MAX_BYTES);
    if (exif.fileOffset + 8 > file.size || exif.fileOffset < 0) return { status: 'malformed' };
    const item = await file.slice(exif.fileOffset, Math.min(exif.fileOffset + length, file.size)).arrayBuffer();
    if (item.byteLength < 8) return { status: 'malformed' };
    const tiffHeaderOffset = new DataView(item).getUint32(0, false);
    const tiffOffset = 4 + tiffHeaderOffset;
    if (tiffOffset + 8 > item.byteLength) return { status: 'malformed' };
    return readGpsFromTiff(item, tiffOffset);
  } catch {
    return { status: 'malformed' };
  }
}
