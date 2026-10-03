/**
 * テスト専用: GPS 位置入りの最小 JPEG / HEIF をバイト単位で組み立てる。アプリ本体からは import しない。
 */

export interface GpsFixtureOptions {
  lat?: number;
  lng?: number;
  littleEndian?: boolean;
  accuracyMeters?: number;
  takenAt?: { date: string; time: [number, number, number] };
  /** 不正データ用: GPS IFD の位置を上書きする（IFD0 と同じ 8 を指定すると循環参照）。 */
  gpsPointer?: number;
  /** 不正データ用: GPS IFD の項目数を上書きする。 */
  gpsEntryCount?: number;
  /** 不正データ用: 緯度の秒の分母を 0 にする。 */
  zeroDenominator?: boolean;
}

class Bytes {
  private readonly chunks: number[] = [];
  constructor(private readonly littleEndian = false) {}
  get length() { return this.chunks.length; }
  u8(...values: number[]) { this.chunks.push(...values.map((value) => value & 0xff)); return this; }
  u16(value: number) { return this.littleEndian ? this.u8(value, value >> 8) : this.u8(value >> 8, value); }
  u32(value: number) {
    return this.littleEndian
      ? this.u8(value, value >> 8, value >> 16, value >>> 24)
      : this.u8(value >>> 24, value >> 16, value >> 8, value);
  }
  text(value: string) { return this.u8(...[...value].map((char) => char.charCodeAt(0))); }
  bytes(values: Uint8Array) { return this.u8(...values); }
  toArray() { return Uint8Array.from(this.chunks); }
}

function dms(value: number): [number, number][] {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minutesFloat = (abs - deg) * 60;
  const min = Math.floor(minutesFloat);
  const sec = Math.round((minutesFloat - min) * 60 * 10_000);
  return [[deg, 1], [min, 1], [sec, 10_000]];
}

/** TIFF ヘッダー + IFD0（GPS ポインタだけ）+ GPS IFD。 */
export function buildGpsTiff(options: GpsFixtureOptions = {}): Uint8Array {
  const { lat = 35.64375, lng = 139.66915, littleEndian = true, accuracyMeters, takenAt } = options;
  const gpsIfdOffset = 26;
  const entries: Array<{ tag: number; type: number; count: number; inline?: number[]; data?: number[][] | string }> = [
    { tag: 1, type: 2, count: 2, inline: [lat < 0 ? 0x53 : 0x4e, 0, 0, 0] },
    { tag: 2, type: 5, count: 3, data: dms(lat).map(([n, d], index) => [n, options.zeroDenominator && index === 2 ? 0 : d]) },
    { tag: 3, type: 2, count: 2, inline: [lng < 0 ? 0x57 : 0x45, 0, 0, 0] },
    { tag: 4, type: 5, count: 3, data: dms(lng) },
  ];
  if (accuracyMeters !== undefined) entries.push({ tag: 0x1f, type: 5, count: 1, data: [[Math.round(accuracyMeters * 100), 100]] });
  if (takenAt) {
    entries.push({ tag: 0x1d, type: 2, count: 11, data: `${takenAt.date}\0` });
    entries.push({ tag: 7, type: 5, count: 3, data: takenAt.time.map((value) => [value, 1]) });
  }
  const tiff = new Bytes(littleEndian);
  tiff.text(littleEndian ? 'II' : 'MM').u16(42).u32(8);
  tiff.u16(1).u16(0x8825).u16(4).u32(1).u32(options.gpsPointer ?? gpsIfdOffset).u32(0);
  let dataOffset = gpsIfdOffset + 2 + entries.length * 12 + 4;
  const data = new Bytes(littleEndian);
  tiff.u16(options.gpsEntryCount ?? entries.length);
  for (const entry of entries) {
    tiff.u16(entry.tag).u16(entry.type).u32(entry.count);
    if (entry.inline) { tiff.u8(...entry.inline); continue; }
    tiff.u32(dataOffset);
    const before = data.length;
    if (typeof entry.data === 'string') data.text(entry.data);
    else for (const [numerator, denominator] of entry.data ?? []) data.u32(numerator).u32(denominator);
    if ((data.length - before) % 2) data.u8(0);
    dataOffset += data.length - before;
  }
  tiff.u32(0);
  return tiff.bytes(data.toArray()).toArray();
}

const app1 = (payload: Uint8Array) => new Bytes().u8(0xff, 0xe1).u16(payload.length + 2).bytes(payload).toArray();
const jpegTail = () => new Bytes().u8(0xff, 0xda).u16(8).u8(1, 1, 0, 0, 0x3f, 0).u8(0x12, 0x34).u8(0xff, 0xd9).toArray();

export function buildJpegWithGps(options: GpsFixtureOptions & { xmpFirst?: boolean } = {}): Uint8Array {
  const out = new Bytes().u8(0xff, 0xd8);
  if (options.xmpFirst) out.bytes(app1(new Bytes().text('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>').toArray()));
  out.bytes(app1(new Bytes().text('Exif\0\0').bytes(buildGpsTiff(options)).toArray()));
  return out.bytes(jpegTail()).toArray();
}

export function buildJpegWithoutGps(): Uint8Array {
  const tiff = new Bytes(true).text('II').u16(42).u32(8).u16(1).u16(0x0112).u16(3).u32(1).u16(1).u16(0).u32(0).toArray();
  return new Bytes().u8(0xff, 0xd8).bytes(app1(new Bytes().text('Exif\0\0').bytes(tiff).toArray())).bytes(jpegTail()).toArray();
}

const box = (type: string, body: Uint8Array) => new Bytes().u32(body.length + 8).text(type).bytes(body).toArray();
const fullBox = (type: string, version: number, body: Uint8Array) => box(type, new Bytes().u8(version, 0, 0, 0).bytes(body).toArray());

export function buildHeifWithGps(options: GpsFixtureOptions & { constructionMethod?: number; extentOffset?: number } = {}): Uint8Array {
  const ftyp = box('ftyp', new Bytes().text('heic').u32(0).text('mif1').text('heic').toArray());
  const infe = fullBox('infe', 2, new Bytes().u16(1).u16(0).text('Exif').u8(0).toArray());
  const iinf = fullBox('iinf', 0, new Bytes().u16(1).bytes(infe).toArray());
  const exifPayload = new Bytes().u32(6).text('Exif\0\0').bytes(buildGpsTiff(options)).toArray();
  const ilocFor = (extentOffset: number) => fullBox('iloc', 1, new Bytes()
    .u8(0x44).u8(0x00).u16(1)
    .u16(1).u16(options.constructionMethod ?? 0).u16(0).u16(1)
    .u32(extentOffset).u32(exifPayload.length).toArray());
  const metaFor = (extentOffset: number) => fullBox('meta', 0, new Bytes().bytes(iinf).bytes(ilocFor(extentOffset)).toArray());
  const metaLength = metaFor(0).length;
  const mdatContentStart = ftyp.length + metaLength + 8;
  return new Bytes()
    .bytes(ftyp)
    .bytes(metaFor(options.extentOffset ?? mdatContentStart))
    .bytes(box('mdat', exifPayload))
    .toArray();
}

/** 決定的な疑似乱数（テストの再現性のため）。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
