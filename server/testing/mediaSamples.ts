import sharp from 'sharp';

/**
 * 試験だけで使う、合成のメディア（A15・A16）。実在の人や場所の写真は使わない。
 * 機種・シリアル・ソフトウェア・XMP・メーカーの独自の情報などは、見つけやすい印（SECRET を含む文字列）にする。
 */

/* ---------- MP4 ---------- */

const u16 = (value: number) => { const buffer = Buffer.alloc(2); buffer.writeUInt16BE(value); return buffer; };
const u32 = (value: number) => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return buffer; };
const u64 = (value: bigint) => { const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(value); return buffer; };
const latin1 = (text: string) => Buffer.from(text, 'latin1');

export const box = (type: string, ...payload: Buffer[]) => { const body = Buffer.concat(payload); return Buffer.concat([u32(body.length + 8), latin1(type), body]); };
const fullBox = (type: string, version: number, ...payload: Buffer[]) => box(type, Buffer.from([version, 0, 0, 0]), ...payload);

/** 1904-01-01 からの秒数。 */
export const macSeconds = (iso: string) => Math.floor(Date.parse(iso) / 1000) + 2_082_844_800;

export function mvhd(version: 0 | 1, creationSeconds: number | bigint) {
  const matrix = Buffer.concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const tail = Buffer.concat([u32(0x10000), u16(0x100), Buffer.alloc(10), matrix, Buffer.alloc(24), u32(3)]);
  return version === 0
    ? fullBox('mvhd', 0, u32(Number(creationSeconds)), u32(Number(creationSeconds)), u32(1000), u32(2000), tail)
    : fullBox('mvhd', 1, u64(BigInt(creationSeconds)), u64(BigInt(creationSeconds)), u32(1000), u64(2000n), tail);
}

const hdlr = (handler: string) => fullBox('hdlr', 0, u32(0), latin1(handler), Buffer.alloc(12), Buffer.from([0]));
/** QuickTime の値（UTF-8）。 */
const dataAtom = (value: string) => box('data', u32(1), u32(0), Buffer.from(value, 'utf8'));
/** QuickTime の udta の文字の項目（長さ・言語・文字）。 */
export const userText = (type: string, value: string) => box(type, u16(Buffer.byteLength(value)), u16(0x15c7), Buffer.from(value, 'utf8'));

/** com.apple.quicktime.* の鍵と値を持つ meta（QuickTime の形。version と flags がない）。 */
export function mdtaMeta(entries: ReadonlyArray<readonly [string, string]>) {
  const keys = fullBox('keys', 0, u32(entries.length), ...entries.map(([name]) => box('mdta', latin1(name))));
  const items = box('ilst', ...entries.map(([, value], index) => box(u32(index + 1).toString('latin1'), dataAtom(value))));
  return box('meta', hdlr('mdta'), keys, items);
}

/** iTunes の形の meta（ISO の meta。version と flags がある）。 */
export const itunesMeta = (entries: ReadonlyArray<readonly [string, string]>) => fullBox('meta', 0, hdlr('mdir'), box('ilst', ...entries.map(([type, value]) => box(type, dataAtom(value)))));

const sampleEntry = (format: string) => box(format, Buffer.alloc(6), u16(1), Buffer.alloc(8));
const stsd = (format: string) => fullBox('stsd', 0, u32(1), sampleEntry(format));

function track(handler: string, format: string, sampleSizes: number[], chunkOffset: number, extra: Buffer[] = []) {
  const stbl = box('stbl', stsd(format), fullBox('stts', 0, u32(0)), fullBox('stsz', 0, u32(0), u32(sampleSizes.length), ...sampleSizes.map(u32)), fullBox('stsc', 0, u32(1), u32(1), u32(sampleSizes.length), u32(1)), fullBox('stco', 0, u32(1), u32(chunkOffset)));
  return box('trak', fullBox('tkhd', 0, Buffer.alloc(80)), box('mdia', fullBox('mdhd', 0, Buffer.alloc(20)), hdlr(handler), box('minf', box('dinf', Buffer.alloc(0)), stbl)), ...extra);
}

export const LOCATION_TEXT = '+35.6894+139.6917+040.000/';
export const CREATION_TEXT = '2026-09-20T10:15:30+0900';
export const VIDEO_FRAME = 'VIDEO-FRAME-PAYLOAD';
/** 消えるべき印。どれかがファイルに残っていれば、許可していない項目が残っている。 */
export const VIDEO_SECRETS = ['MAKE-SECRET', 'MODEL-SECRET', 'SOFTWARE-SECRET', 'SERIAL-SECRET', 'XMP-SECRET', 'GPMF-SECRET', 'CAMM-SECRET', 'TRACK-SECRET', 'CONTENT-ID-SECRET', 'PADDING-SECRET'] as const;

export interface VideoOptions {
  mvhdVersion?: 0 | 1;
  mvhdSeconds?: number | bigint;
  /** com.apple.quicktime.creationdate の値。null なら書かない。 */
  appleCreation?: string | null;
  fragmented?: boolean;
  brand?: string;
  /** 合わせて入れる時刻つきメタデータのトラック。 */
  timedMetadata?: boolean;
}

/**
 * 機種・シリアル・XMP・位置・作成日時と、時刻つきメタデータのトラック（gpmd・camm）を持つ合成の MP4。
 * moov/udta（©xyz・loci・©day・©mak・©mod・©swr・XMP_・CAME・meta）、moov/meta（Apple の鍵）、最上位と track の uuid（XMP）、
 * track ごとの udta と meta、最上位の free の中の古い値、mdat の中の gpmd・camm のサンプルを持つ。
 */
export function syntheticVideo(options: VideoOptions = {}) {
  const { mvhdVersion = 0, mvhdSeconds = macSeconds('2026-09-20T01:15:30Z'), appleCreation = CREATION_TEXT, fragmented = false, brand = 'isom', timedMetadata = true } = options;
  const ftyp = box('ftyp', latin1(brand), u32(0), latin1(brand));
  const xmp = (marker: string) => box('uuid', Buffer.from('be7acfcb97a942e89c71999491e3afac', 'hex'), Buffer.from(`<x:xmpmeta><rdf:Description tiff:Make="${marker}"/></x:xmpmeta>`, 'utf8'));
  const udta = box('udta',
    userText('©xyz', LOCATION_TEXT), box('loci', Buffer.alloc(4), latin1('home\0'), u16(0), Buffer.alloc(12)), userText('©day', CREATION_TEXT),
    userText('©mak', 'MAKE-SECRET'), userText('©mod', 'MODEL-SECRET'), userText('©swr', 'SOFTWARE-SECRET'), box('XMP_', latin1('<x:xmpmeta>XMP-SECRET</x:xmpmeta>')), box('CAME', latin1('SERIAL-SECRET')),
    itunesMeta([['©too', 'SOFTWARE-SECRET encoder'], ['©xyz', LOCATION_TEXT], ['©day', CREATION_TEXT]]),
  );
  const apple: Array<[string, string]> = [['com.apple.quicktime.location.ISO6709', LOCATION_TEXT], ['com.apple.quicktime.make', 'MAKE-SECRET'], ['com.apple.quicktime.model', 'MODEL-SECRET'], ['com.apple.quicktime.software', 'SOFTWARE-SECRET'], ['com.apple.quicktime.content.identifier', 'CONTENT-ID-SECRET']];
  if (appleCreation !== null) apple.splice(1, 0, ['com.apple.quicktime.creationdate', appleCreation]);
  const samples = [Buffer.from(VIDEO_FRAME, 'latin1'), Buffer.from('GPMF-SECRET DVNM GPS5 +35.68 +139.69', 'latin1'), Buffer.from('CAMM-SECRET 35.6894 139.6917', 'latin1')];
  const build = (mdatStart: number) => {
    const offsets = samples.reduce<number[]>((list, sample, index) => [...list, index ? list[index - 1] + samples[index - 1].length : mdatStart], []);
    const tracks = [track('vide', 'avc1', [samples[0].length], offsets[0], [box('udta', userText('©mak', 'TRACK-SECRET')), itunesMeta([['©too', 'TRACK-SECRET']]), xmp('XMP-SECRET track')])];
    if (timedMetadata) tracks.push(track('meta', 'gpmd', [samples[1].length], offsets[1]), track('camm', 'camm', [samples[2].length], offsets[2]));
    return box('moov', mvhd(mvhdVersion, mvhdSeconds), ...tracks, udta, mdtaMeta(apple), box('free', latin1('PADDING-SECRET')));
  };
  const head = (moov: Buffer) => Buffer.concat([ftyp, xmp('XMP-SECRET top'), box('free', latin1('PADDING-SECRET old')), moov]);
  const probe = head(build(0));
  const moov = build(probe.length + 8);
  const tail = fragmented ? [box('moof', fullBox('mfhd', 0, u32(1)), box('traf', fullBox('tfhd', 0, u32(1))))] : [];
  return Buffer.concat([head(moov), box('mdat', ...samples), ...tail]);
}

/* ---------- JPEG の EXIF ---------- */

interface Field { tag: number; type: number; count: number; data: Buffer }
const le16 = (value: number) => { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; };
const le32 = (value: number) => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value); return buffer; };
const asciiField = (tag: number, text: string): Field => ({ tag, type: 2, count: Buffer.byteLength(text, 'latin1') + 1, data: Buffer.from(`${text}\0`, 'latin1') });
const shortField = (tag: number, value: number): Field => ({ tag, type: 3, count: 1, data: le16(value) });
const longField = (tag: number, value: number): Field => ({ tag, type: 4, count: 1, data: le32(value) });
const byteField = (tag: number, value: number): Field => ({ tag, type: 1, count: 1, data: Buffer.from([value]) });
const rationalField = (tag: number, pairs: ReadonlyArray<readonly [number, number]>): Field => ({ tag, type: 5, count: pairs.length, data: Buffer.concat(pairs.flatMap(([numerator, denominator]) => [le32(numerator), le32(denominator)])) });
const undefinedField = (tag: number, data: Buffer): Field => ({ tag, type: 7, count: data.length, data });

/** IFD を順に並べ、4バイトを超える値を後ろにまとめた TIFF（リトルエンディアン）。pointers は IFD0 から指す IFD の番号。 */
function tiff(ifds: Field[][], link: (offsets: number[]) => void, trailer: Buffer = Buffer.alloc(0)) {
  const sizes = ifds.map((fields) => 2 + fields.length * 12 + 4);
  const offsets: number[] = [];
  let at = 8;
  for (const size of sizes) { offsets.push(at); at += size; }
  link(offsets);
  const values: Buffer[] = [];
  let dataAt = at;
  const tables = ifds.map((fields, index) => {
    const sorted = [...fields].sort((a, b) => a.tag - b.tag);
    const entries = sorted.map((field) => {
      let slot = Buffer.alloc(4);
      if (field.data.length <= 4) field.data.copy(slot);
      else { slot = le32(dataAt); values.push(field.data); dataAt += field.data.length + (field.data.length % 2); if (field.data.length % 2) values.push(Buffer.alloc(1)); }
      return Buffer.concat([le16(field.tag), le16(field.type), le32(field.count), slot]);
    });
    const next = index === 0 && ifds.length > 3 ? le32(offsets[3]) : le32(0);
    return Buffer.concat([le16(sorted.length), ...entries, next]);
  });
  const body = Buffer.concat([Buffer.from('II'), le16(42), le32(8), ...tables, ...values]);
  return { body: Buffer.concat([body, trailer]), trailerAt: body.length };
}

const dmsPairs = (value: number): Array<[number, number]> => {
  const total = Math.round(Math.abs(value) * 3_600_000);
  const degrees = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total - degrees * 3_600_000) / 60_000);
  return [[degrees, 1], [minutes, 1], [total - degrees * 3_600_000 - minutes * 60_000, 1000]];
};

export interface PhotoExif { lat?: number; lng?: number; altitude?: number; dateTimeOriginal?: string; offsetTimeOriginal?: string; orientation?: number; thumbnail?: Buffer }

/**
 * 機種・ソフトウェア・シリアル・メーカーの独自の情報・縮小画像（IFD1）と、GPS・撮影日時を持つ EXIF（"Exif\0\0" から）。
 */
export function photoExif(options: PhotoExif): Buffer {
  const ifd0: Field[] = [asciiField(0x010f, 'MAKE-SECRET'), asciiField(0x0110, 'MODEL-SECRET'), asciiField(0x0131, 'SOFTWARE-SECRET'), asciiField(0x013b, 'ARTIST-SECRET'), shortField(0x0112, options.orientation ?? 1), longField(0x8769, 0), longField(0x8825, 0)];
  const exif: Field[] = [asciiField(0xa431, 'SERIAL-SECRET'), asciiField(0xa434, 'LENS-SECRET'), undefinedField(0x927c, Buffer.from('MAKERNOTE-SECRET-0123456789', 'latin1'))];
  if (options.dateTimeOriginal) exif.push(asciiField(0x9003, options.dateTimeOriginal));
  if (options.offsetTimeOriginal) exif.push(asciiField(0x9011, options.offsetTimeOriginal));
  const gps: Field[] = [{ tag: 0, type: 1, count: 4, data: Buffer.from([2, 3, 0, 0]) }];
  if (options.lat !== undefined && options.lng !== undefined) {
    gps.push(asciiField(1, options.lat < 0 ? 'S' : 'N'), rationalField(2, dmsPairs(options.lat)), asciiField(3, options.lng < 0 ? 'W' : 'E'), rationalField(4, dmsPairs(options.lng)));
    if (options.altitude !== undefined) gps.push(byteField(5, options.altitude < 0 ? 1 : 0), rationalField(6, [[Math.round(Math.abs(options.altitude) * 100), 100]]));
  }
  const thumbnail = options.thumbnail ?? Buffer.alloc(0);
  const ifd1: Field[] = [longField(0x0201, 0), longField(0x0202, thumbnail.length), shortField(0x0103, 6)];
  let built = tiff([ifd0, exif, gps, ifd1], () => undefined);
  // 位置が決まってから、IFD0 の指す先と縮小画像の位置を書き直す。
  for (let pass = 0; pass < 2; pass += 1) {
    built = tiff([ifd0, exif, gps, ifd1], (offsets) => {
      ifd0[5] = longField(0x8769, offsets[1]);
      ifd0[6] = longField(0x8825, offsets[2]);
    }, thumbnail);
    ifd1[0] = longField(0x0201, built.trailerAt);
  }
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), built.body]);
}

/** sharp で描いた JPEG の SOI の直後に、APP1（EXIF）を差し込む。 */
export function withApp1(jpeg: Buffer, exif: Buffer) {
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]);
}

/** 64x48 の JPEG に、機種・シリアル・縮小画像と GPS・撮影日時を持つ EXIF を付けたもの。 */
export async function syntheticPhoto(options: PhotoExif) {
  const base = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).jpeg().toBuffer();
  const thumbnail = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#993366' } }).jpeg().toBuffer();
  return withApp1(base, photoExif({ thumbnail, ...options }));
}

export const PHOTO_SECRETS = ['MAKE-SECRET', 'MODEL-SECRET', 'SOFTWARE-SECRET', 'ARTIST-SECRET', 'SERIAL-SECRET', 'LENS-SECRET', 'MAKERNOTE-SECRET'] as const;
