/**
 * EXIF（TIFF の形）の最小限の読み取り。画面（写真の場所の読み取り）とサーバー（撮影日時と位置）で共有する。
 * 入力は信頼できないバイト列として扱う。読む範囲・ループ回数・参照先をすべて制限し、例外を外へ出さない。
 */

export interface GpsReading { lat: number; lng: number; accuracyMeters?: number; takenAt?: string }
export type PhotoGpsOutcome =
  | { status: 'found'; gps: GpsReading }
  | { status: 'no-gps' | 'unsupported' | 'malformed' | 'too-large' };

export const MAX_IFD_ENTRIES = 256;

export class Malformed extends Error {}

/** 範囲外の読み取りはすべて Malformed にする DataView の薄いラッパー。 */
export class Reader {
  private readonly view: DataView;
  readonly length: number;
  littleEndian = false;
  constructor(buffer: ArrayBuffer) { this.view = new DataView(buffer); this.length = buffer.byteLength; }
  private check(offset: number, size: number) {
    if (!Number.isInteger(offset) || offset < 0 || offset + size > this.length) throw new Malformed();
  }
  u8(offset: number) { this.check(offset, 1); return this.view.getUint8(offset); }
  u16(offset: number) { this.check(offset, 2); return this.view.getUint16(offset, this.littleEndian); }
  u32(offset: number) { this.check(offset, 4); return this.view.getUint32(offset, this.littleEndian); }
  u64(offset: number) {
    this.check(offset, 8);
    const value = this.view.getBigUint64(offset, this.littleEndian);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Malformed();
    return Number(value);
  }
  /** 0/4/8 バイトの符号なし整数（HEIF の iloc 用）。 */
  uint(offset: number, size: number) {
    if (size === 0) return 0;
    if (size === 4) return this.u32(offset);
    if (size === 8) return this.u64(offset);
    throw new Malformed();
  }
  ascii(offset: number, size: number) {
    this.check(offset, size);
    let text = '';
    for (let index = 0; index < size; index += 1) {
      const code = this.view.getUint8(offset + index);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  }
}

const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;
const TYPE_IFD = 13;
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 13: 4 };

interface Entry { tag: number; type: number; count: number; valueOffset: number }

function readIfd(reader: Reader, tiffStart: number, ifdOffset: number): Entry[] {
  const at = tiffStart + ifdOffset;
  const count = reader.u16(at);
  if (count > MAX_IFD_ENTRIES) throw new Malformed();
  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = at + 2 + index * 12;
    const tag = reader.u16(entry);
    const type = reader.u16(entry + 2);
    const valueCount = reader.u32(entry + 4);
    const size = (TYPE_SIZE[type] ?? 0) * valueCount;
    if (size === 0 || size > 1024) continue; // 未知の型や巨大な値は読まない
    const valueOffset = size <= 4 ? entry + 8 : tiffStart + reader.u32(entry + 8);
    entries.push({ tag, type, count: valueCount, valueOffset });
  }
  return entries;
}

function rational(reader: Reader, offset: number): number | null {
  const numerator = reader.u32(offset);
  const denominator = reader.u32(offset + 4);
  return denominator === 0 ? null : numerator / denominator;
}

function rationals(reader: Reader, entry: Entry | undefined, count: number): number[] | null {
  if (!entry || entry.type !== TYPE_RATIONAL || entry.count !== count) return null;
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = rational(reader, entry.valueOffset + index * 8);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function ascii(reader: Reader, entry: Entry | undefined): string | null {
  return entry && entry.type === TYPE_ASCII ? reader.ascii(entry.valueOffset, Math.min(entry.count, 32)) : null;
}

function degrees(parts: number[] | null, ref: string | null, positive: string, negative: string, max: number): number | null {
  if (!parts || (ref !== positive && ref !== negative)) return null;
  const [deg, min, sec] = parts;
  if (deg > max || min >= 60 || sec >= 60) return null;
  const value = deg + min / 60 + sec / 3600;
  return value > max ? null : ref === negative ? -value : value;
}

function timestamp(date: string | null, time: number[] | null): string | undefined {
  const match = date?.match(/^(\d{4}):(\d{2}):(\d{2})$/);
  if (!match || !time) return undefined;
  const [hours, minutes, seconds] = time.map(Math.floor);
  if (hours > 23 || minutes > 59 || seconds > 60) return undefined;
  const pad = (value: number) => String(value).padStart(2, '0');
  const iso = `${match[1]}-${match[2]}-${match[3]}T${pad(hours)}:${pad(minutes)}:${pad(Math.min(seconds, 59))}Z`;
  const parsed = new Date(iso);
  // 2月31日のような存在しない日付は Date が繰り上げるため、往復して一致しなければ捨てる。
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso.slice(0, 10) ? undefined : iso;
}

/** TIFF の頭を読み、IFD0 を返す。 */
function openTiff(buffer: ArrayBuffer, tiffOffset: number, tiffEnd: number) {
  const reader = new Reader(buffer.slice(0, Math.min(tiffEnd, buffer.byteLength)));
  const order = reader.ascii(tiffOffset, 2);
  if (order === 'II') reader.littleEndian = true;
  else if (order !== 'MM') throw new Malformed();
  if (reader.u16(tiffOffset + 2) !== 42) throw new Malformed();
  const ifd0Offset = reader.u32(tiffOffset + 4);
  return { reader, ifd0Offset, ifd0: readIfd(reader, tiffOffset, ifd0Offset) };
}

/** IFD0 の中の、ほかの IFD を指す項目（Exif は 0x8769、GPS は 0x8825）の先。なければ null。 */
function subIfd(reader: Reader, tiffOffset: number, ifd0Offset: number, ifd0: Entry[], tag: number) {
  const pointer = ifd0.find((entry) => entry.tag === tag);
  if (!pointer || (pointer.type !== TYPE_LONG && pointer.type !== TYPE_IFD) || pointer.count !== 1) return null;
  const offset = reader.u32(pointer.valueOffset);
  if (offset === ifd0Offset) throw new Malformed(); // 自分自身を指す参照（循環）
  return new Map(readIfd(reader, tiffOffset, offset).map((entry) => [entry.tag, entry]));
}

export function readGpsFromTiff(buffer: ArrayBuffer, tiffOffset: number, tiffEnd = buffer.byteLength): PhotoGpsOutcome {
  try {
    const { reader, ifd0Offset, ifd0 } = openTiff(buffer, tiffOffset, tiffEnd);
    const gps = subIfd(reader, tiffOffset, ifd0Offset, ifd0, 0x8825);
    if (!gps) return { status: 'no-gps' };
    const lat = degrees(rationals(reader, gps.get(2), 3), ascii(reader, gps.get(1)), 'N', 'S', 90);
    const lng = degrees(rationals(reader, gps.get(4), 3), ascii(reader, gps.get(3)), 'E', 'W', 180);
    if (lat === null || lng === null || (lat === 0 && lng === 0)) return { status: 'no-gps' };
    const error = rationals(reader, gps.get(0x1f), 1)?.[0];
    const takenAt = timestamp(ascii(reader, gps.get(0x1d)), rationals(reader, gps.get(7), 3));
    return {
      status: 'found',
      gps: { lat, lng, ...(error !== undefined && Number.isFinite(error) && error > 0 ? { accuracyMeters: error } : {}), ...(takenAt ? { takenAt } : {}) },
    };
  } catch {
    return { status: 'malformed' };
  }
}

/** 写真の EXIF から、撮影日時（DateTimeOriginal・OffsetTimeOriginal）と位置（緯度・経度・高度）だけを読む。 */
export interface PhotoFacts {
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  gps?: { lat: number; lng: number; altitude?: number };
}

/**
 * EXIF の塊（"Exif\0\0" で始まってもよい）から PhotoFacts を読む。読めなければ空。
 * 位置は readGpsFromTiff と同じ規則で読み、高度は GPSAltitudeRef（1 なら海面下）と GPSAltitude から読む。
 */
export function readPhotoFacts(exif: Uint8Array): PhotoFacts {
  const copy = exif.slice();
  const buffer = copy.buffer;
  const tiffOffset = copy.length >= 6 && String.fromCharCode(...copy.subarray(0, 4)) === 'Exif' && copy[4] === 0 && copy[5] === 0 ? 6 : 0;
  const facts: PhotoFacts = {};
  try {
    const { reader, ifd0Offset, ifd0 } = openTiff(buffer, tiffOffset, buffer.byteLength);
    const exifIfd = subIfd(reader, tiffOffset, ifd0Offset, ifd0, 0x8769);
    const original = ascii(reader, exifIfd?.get(0x9003));
    const offset = ascii(reader, exifIfd?.get(0x9011));
    if (original) facts.dateTimeOriginal = original;
    if (offset) facts.offsetTimeOriginal = offset;
    const location = readGpsFromTiff(buffer, tiffOffset);
    if (location.status === 'found') {
      const gps = subIfd(reader, tiffOffset, ifd0Offset, ifd0, 0x8825);
      const altitude = rationals(reader, gps?.get(6), 1)?.[0];
      const ref = gps?.get(5);
      const below = ref && ref.type === 1 && ref.count === 1 ? reader.u8(ref.valueOffset) === 1 : false;
      facts.gps = { lat: location.gps.lat, lng: location.gps.lng, ...(altitude !== undefined && Number.isFinite(altitude) ? { altitude: below ? -altitude : altitude } : {}) };
    }
  } catch {
    return facts;
  }
  return facts;
}
