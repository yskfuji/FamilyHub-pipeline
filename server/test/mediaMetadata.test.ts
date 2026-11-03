import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { serverMessages } from '../../src/content/serverMessages';
import { readVideoCaptureTime, scrubVideoMetadata, UnsupportedVideoMetadata } from '../media/mp4Metadata';
import { originalPath } from '../media/pipeline';
import { box, CREATION_TEXT, LOCATION_TEXT, macSeconds, mdtaMeta, mvhd, PHOTO_SECRETS, syntheticPhoto, syntheticVideo, userText, VIDEO_FRAME, VIDEO_SECRETS } from '../testing/mediaSamples';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

const worlds: World[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map((world) => world.close())); });
const open = (...args: Parameters<typeof createWorld>) => { const world = createWorld(...args); worlds.push(world); return world; };
const settled = async (world: World) => { await world.ready; await new Promise((done) => setTimeout(done, 20)); await Promise.all([...world.deps.jobs]); };
const asFile = (bytes: Buffer, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });
const NOW = new Date('2026-09-30T07:45:00+09:00');
const tempFile = (bytes: Buffer, name = 'video.mp4') => { const path = join(mkdtempSync(join(tmpdir(), 'media-meta-')), name); writeFileSync(path, bytes); return path; };

/**
 * 試験の側の、独立した読み取り。残っているメタデータの項目を集める（free は数えない）。
 * udta の子の種類、meta の ilst の項目（鍵があれば鍵の名前、なければ種類）、uuid の箱、meta の中の知らない箱。
 */
function remainingMetadata(file: Buffer) {
  const found = { udta: new Set<string>(), items: new Set<string>(), uuid: 0, metaOther: new Set<string>() };
  const boxes = (from: number, to: number) => {
    const list: Array<{ type: string; start: number; body: number; end: number }> = [];
    for (let at = from; at + 8 <= to;) {
      const size = file.readUInt32BE(at);
      if (size < 8) break;
      list.push({ type: file.toString('latin1', at + 4, at + 8), start: at, body: at + 8, end: at + size });
      at += size;
    }
    return list;
  };
  const meta = (start: number, end: number) => {
    const first = file.toString('latin1', start + 4, start + 8) === 'hdlr' ? start : start + 4;
    const parts = boxes(first, end);
    const keysBox = parts.find((part) => part.type === 'keys');
    const names: string[] = [];
    if (keysBox) for (let at = keysBox.body + 8; at < keysBox.end;) { const size = file.readUInt32BE(at); names.push(file.toString('latin1', at + 8, at + size)); at += size; }
    for (const part of parts) {
      if (part.type === 'ilst') for (const item of boxes(part.body, part.end)) {
        if (boxes(item.body, item.end).every((inner) => inner.type === 'free')) continue;
        found.items.add(keysBox ? names[file.readUInt32BE(item.start + 4) - 1] : item.type);
      } else if (!['hdlr', 'keys', 'free'].includes(part.type)) found.metaOther.add(part.type);
    }
  };
  const walk = (from: number, to: number) => {
    for (const item of boxes(from, to)) {
      if (item.type === 'uuid') found.uuid += 1;
      else if (item.type === 'udta') for (const child of boxes(item.body, item.end)) { if (child.type === 'meta') meta(child.body, child.end); else if (child.type !== 'free') found.udta.add(child.type); }
      else if (item.type === 'meta') meta(item.body, item.end);
      else if (['moov', 'trak', 'mdia', 'minf'].includes(item.type)) walk(item.body, item.end);
    }
  };
  walk(0, file.length);
  return { udta: [...found.udta].sort(), items: [...found.items].sort(), uuid: found.uuid, metaOther: [...found.metaOther].sort() };
}

describe('capture time of videos (A15)', () => {
  it('prefers com.apple.quicktime.creationdate with its offset', async () => {
    expect(await readVideoCaptureTime(tempFile(syntheticVideo()), 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T10:15:30+09:00', takenAtSource: 'quicktime-key' });
    expect(await readVideoCaptureTime(tempFile(syntheticVideo({ appleCreation: '2026-09-20T10:15:30-04:00' })), 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T10:15:30-04:00', takenAtSource: 'quicktime-key' });
  });

  it('reads mvhd version 0 and version 1 as UTC since 1904, written in the household time zone', async () => {
    const seconds = macSeconds('2026-09-19T23:59:58Z');
    expect(seconds).toBe(3_872_707_198);
    expect(await readVideoCaptureTime(tempFile(syntheticVideo({ appleCreation: null, mvhdVersion: 0, mvhdSeconds: seconds })), 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T08:59:58+09:00', takenAtSource: 'mvhd' });
    expect(await readVideoCaptureTime(tempFile(syntheticVideo({ appleCreation: null, mvhdVersion: 1, mvhdSeconds: BigInt(seconds) })), 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T08:59:58+09:00', takenAtSource: 'mvhd' });
    // 64 ビットでしか書けない値（2040年より後）も読む。未来すぎるので採らない。
    expect(await readVideoCaptureTime(tempFile(syntheticVideo({ appleCreation: null, mvhdVersion: 1, mvhdSeconds: 2n ** 32n + 10n })), 'Asia/Tokyo', NOW)).toBeNull();
  });

  it('discards zero, dates before 1990, more than a day ahead, and a broken Apple value (falling back to mvhd)', async () => {
    const at = (options: Parameters<typeof syntheticVideo>[0]) => readVideoCaptureTime(tempFile(syntheticVideo(options)), 'Asia/Tokyo', NOW);
    expect(await at({ appleCreation: null, mvhdSeconds: 0 })).toBeNull();
    expect(await at({ appleCreation: null, mvhdSeconds: macSeconds('1989-12-31T23:59:59Z') })).toBeNull();
    expect(await at({ appleCreation: null, mvhdSeconds: macSeconds('1990-01-01T00:00:00Z') })).toMatchObject({ takenAtSource: 'mvhd' });
    expect(await at({ appleCreation: null, mvhdSeconds: macSeconds('2026-10-01T23:00:00Z') })).toBeNull();
    expect(await at({ appleCreation: null, mvhdSeconds: macSeconds('2026-09-30T20:00:00Z') })).toMatchObject({ takenAtSource: 'mvhd' });
    for (const broken of ['2026-09-20T10:15:30', '2026-02-31T10:00:00+0900', 'yesterday', '2026-09-20T25:00:00+0900', '2031-01-01T00:00:00+0900', '1970-01-01T00:00:00Z']) {
      expect(await at({ appleCreation: broken }), broken).toEqual({ takenAt: '2026-09-20T10:15:30+09:00', takenAtSource: 'mvhd' });
    }
  });
});

describe('video metadata outside the allowlist (A16-2)', () => {
  it('blanks make, model, software, serials, XMP, per-track metadata and gpmd/camm samples, keeping only the creation date, without changing the length', async () => {
    const original = syntheticVideo();
    expect(remainingMetadata(original).uuid).toBe(2);
    for (const secret of VIDEO_SECRETS) expect(original.includes(Buffer.from(secret)), secret).toBe(true);
    const path = tempFile(original);
    const result = await scrubVideoMetadata(path, { keepLocation: false });
    const scrubbed = readFileSync(path);
    expect(scrubbed.length).toBe(original.length);
    for (const secret of VIDEO_SECRETS) expect(scrubbed.includes(Buffer.from(secret)), secret).toBe(false);
    expect(scrubbed.includes(Buffer.from(LOCATION_TEXT))).toBe(false);
    expect(scrubbed.includes(Buffer.from('+35.68'))).toBe(false);
    expect(remainingMetadata(scrubbed)).toEqual({ udta: ['©day'], items: ['com.apple.quicktime.creationdate', '©day'], uuid: 0, metaOther: [] });
    expect(result.blankedSamples).toBe(2);
    // 映像のサンプルと作成日時は残る。
    expect(scrubbed.includes(Buffer.from(VIDEO_FRAME))).toBe(true);
    expect(await readVideoCaptureTime(path, 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T10:15:30+09:00', takenAtSource: 'quicktime-key' });
  });

  it('keeps the location items, and only them besides the date, when asked', async () => {
    const path = tempFile(syntheticVideo());
    await scrubVideoMetadata(path, { keepLocation: true });
    const kept = readFileSync(path);
    for (const secret of VIDEO_SECRETS) expect(kept.includes(Buffer.from(secret)), secret).toBe(false);
    expect(remainingMetadata(kept)).toEqual({ udta: ['loci', '©day', '©xyz'], items: ['com.apple.quicktime.creationdate', 'com.apple.quicktime.location.ISO6709', '©day', '©xyz'], uuid: 0, metaOther: [] });
    // ©xyz・鍵の値・iTunes の ©xyz の3か所で読める。
    expect(kept.toString('latin1').split(LOCATION_TEXT).length - 1).toBe(3);
  });

  it('refuses what it cannot handle: timed metadata in a fragmented file, a compressed header, broken boxes', async () => {
    await expect(scrubVideoMetadata(tempFile(syntheticVideo({ fragmented: true })), { keepLocation: false })).rejects.toBeInstanceOf(UnsupportedVideoMetadata);
    await expect(scrubVideoMetadata(tempFile(syntheticVideo({ fragmented: true })), { keepLocation: true })).rejects.toBeInstanceOf(UnsupportedVideoMetadata);
    // 時刻つきメタデータのない断片のファイルは扱える。
    await expect(scrubVideoMetadata(tempFile(syntheticVideo({ fragmented: true, timedMetadata: false })), { keepLocation: false })).resolves.toMatchObject({ blankedSamples: 0 });
    const compressed = Buffer.concat([box('ftyp', Buffer.from('qt  \0\0\0\0qt  ', 'latin1')), box('moov', box('cmov', Buffer.alloc(16)))]);
    await expect(scrubVideoMetadata(tempFile(compressed), { keepLocation: false })).rejects.toBeInstanceOf(UnsupportedVideoMetadata);
    const trailing = Buffer.concat([syntheticVideo(), Buffer.from('JUNK')]);
    await expect(scrubVideoMetadata(tempFile(trailing), { keepLocation: false })).rejects.toThrow('trailing bytes');
    // QuickTime の udta の末尾の 0 の4バイトは許す。
    const terminated = Buffer.concat([box('ftyp', Buffer.from('qt  \0\0\0\0qt  ', 'latin1')), box('moov', mvhd(0, macSeconds('2026-09-20T00:00:00Z')), box('udta', userText('©mak', 'MAKE-SECRET'), Buffer.alloc(4))), box('mdat', Buffer.alloc(8))]);
    const path = tempFile(terminated);
    await scrubVideoMetadata(path, { keepLocation: false });
    expect(readFileSync(path).includes(Buffer.from('MAKE-SECRET'))).toBe(false);
  });

  it('handles the H.264 sample clip made with AVFoundation', async () => {
    const sample = readFileSync(resolve('src/data/samples/sample-clip.mp4'));
    const path = tempFile(sample);
    await scrubVideoMetadata(path, { keepLocation: false });
    expect(readFileSync(path).length).toBe(sample.length);
    expect(await readVideoCaptureTime(path, 'Asia/Tokyo', new Date())).toMatchObject({ takenAtSource: 'mvhd' });
  });

  it('records the capture time before scrubbing, and rejects an upload it cannot scrub with the reason', async () => {
    const world = open();
    const ok = await world.gateway.albums.uploadItem('album-sports', asFile(syntheticVideo(), 'v.mp4', 'video/mp4'), { keepLocation: false });
    const refused = await world.gateway.albums.uploadItem('album-sports', asFile(syntheticVideo({ fragmented: true, mvhdSeconds: macSeconds('2026-09-21T00:00:00Z') }), 'f.mp4', 'video/mp4'), { keepLocation: true });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    const find = (id: string) => (album.ok ? album.value.items.find((item) => item.id === id) : undefined);
    expect(ok.ok && find(ok.value.itemId)).toMatchObject({ status: 'ready', kind: 'video', takenAt: '2026-09-20T10:15:30+09:00', takenAtSource: 'quicktime-key' });
    expect(refused.ok && find(refused.value.itemId)).toMatchObject({ status: 'rejected', statusMessage: serverMessages.videoMetadataUnsupported });
    const stored = readFileSync(originalPath(world.deps.config.mediaPath, 'house-mori', ok.ok ? ok.value.itemId : ''));
    for (const secret of VIDEO_SECRETS) expect(stored.includes(Buffer.from(secret)), secret).toBe(false);
    expect(stored.includes(Buffer.from(CREATION_TEXT))).toBe(true);
  });
});

describe('photos are always re-encoded, with a minimal EXIF when the location is kept (A15, A16-1)', () => {
  const exif = { lat: 35.689_444, lng: 139.691_667, altitude: 40.5, dateTimeOriginal: '2026:09:20 09:12:30', offsetTimeOriginal: '+09:00', orientation: 6 };

  it('the synthetic photo carries everything an independent reader can see', async () => {
    const original = await syntheticPhoto(exif);
    const parsed = await exifr.parse(original, { tiff: true, exif: true, gps: true, ifd1: true, makerNote: true });
    expect(parsed).toMatchObject({ Make: 'MAKE-SECRET', Model: 'MODEL-SECRET', Software: 'SOFTWARE-SECRET', SerialNumber: 'SERIAL-SECRET', LensModel: 'LENS-SECRET', Orientation: expect.anything() });
    expect(parsed.makerNote).toBeDefined();
    expect(parsed.latitude).toBeCloseTo(exif.lat, 5);
    expect(await exifr.thumbnail(original)).toBeInstanceOf(Uint8Array);
  });

  it('keeps only GPS, the capture time and its offset, readable by exifr, and rotates the pixels', async () => {
    const world = open();
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(await syntheticPhoto(exif), 'keep.jpg', 'image/jpeg'), { keepLocation: true });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    const item = album.ok ? album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId) : undefined;
    expect(item).toMatchObject({ status: 'ready', locationKept: true, width: 48, height: 64, takenAt: '2026-09-20T09:12:30+09:00', takenAtSource: 'exif-offset' });
    const stored = readFileSync(originalPath(world.deps.config.mediaPath, 'house-mori', item!.id));
    const gps = await exifr.gps(stored);
    expect(gps.latitude).toBeCloseTo(exif.lat, 6);
    expect(gps.longitude).toBeCloseTo(exif.lng, 6);
    const parsed = await exifr.parse(stored, { tiff: true, exif: true, gps: true, ifd1: true, makerNote: true, userComment: true, xmp: true, icc: false, iptc: true, translateValues: false });
    expect(parsed.GPSAltitude).toBeCloseTo(40.5, 2);
    expect(Number(parsed.GPSAltitudeRef?.[0] ?? parsed.GPSAltitudeRef)).toBe(0);
    expect(parsed.DateTimeOriginal).toBeInstanceOf(Date);
    expect(parsed.OffsetTimeOriginal).toBe('+09:00');
    for (const tag of ['Make', 'Model', 'Software', 'Artist', 'SerialNumber', 'BodySerialNumber', 'LensModel', 'MakerNote', 'makerNote', 'ImageDescription', 'HostComputer', 'CameraOwnerName']) expect(parsed[tag], tag).toBeUndefined();
    // libexif が形式のために足す項目のほかは、許可した項目だけ。
    const structural = ['Orientation', 'XResolution', 'YResolution', 'ResolutionUnit', 'YCbCrPositioning', 'ExifVersion', 'ComponentsConfiguration', 'FlashpixVersion', 'ColorSpace', 'ExifImageWidth', 'ExifImageHeight', 'GPSVersionID'];
    const allowed = ['latitude', 'longitude', 'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef', 'DateTimeOriginal', 'OffsetTimeOriginal', ...structural];
    expect(Object.keys(parsed).filter((key) => !allowed.includes(key))).toEqual([]);
    expect(parsed.Orientation ?? 1).toBe(1);
    expect(await exifr.thumbnail(stored)).toBeUndefined();
    for (const secret of PHOTO_SECRETS) expect(stored.includes(Buffer.from(secret)), secret).toBe(false);
    expect((await sharp(stored).metadata())).toMatchObject({ width: 48, height: 64 });
  });

  it('writes the minimal EXIF into a PNG as well', async () => {
    const png = await sharp({ create: { width: 30, height: 20, channels: 4, background: '#33669980' } }).png().withExif({ IFD0: { Make: 'MAKE-SECRET' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '139/1 42/1 0/1' } }).toBuffer();
    const world = open();
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(png, 'keep.png', 'image/png'), { keepLocation: true });
    await settled(world);
    const stored = readFileSync(originalPath(world.deps.config.mediaPath, 'house-mori', uploaded.ok ? uploaded.value.itemId : ''));
    expect((await sharp(stored).metadata())).toMatchObject({ format: 'png', width: 30, height: 20, channels: 4 });
    const gps = await exifr.gps(stored);
    expect(gps.latitude).toBeCloseTo(35 + 41 / 60, 6);
    expect(gps.longitude).toBeCloseTo(139.7, 6);
    expect(stored.includes(Buffer.from('MAKE-SECRET'))).toBe(false);
  });

  it('writes no EXIF at all when the location is removed, but still records the capture time', async () => {
    const world = open();
    const uploaded = await world.gateway.albums.uploadItem('album-sports', asFile(await syntheticPhoto(exif), 'strip.jpg', 'image/jpeg'), { keepLocation: false });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    const item = album.ok ? album.value.items.find((entry) => uploaded.ok && entry.id === uploaded.value.itemId) : undefined;
    expect(item).toMatchObject({ status: 'ready', locationKept: false, width: 48, height: 64, takenAt: '2026-09-20T09:12:30+09:00', takenAtSource: 'exif-offset' });
    const stored = readFileSync(originalPath(world.deps.config.mediaPath, 'house-mori', item!.id));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(await exifr.parse(stored, { tiff: true, exif: true, gps: true })).toBeUndefined();
    for (const secret of PHOTO_SECRETS) expect(stored.includes(Buffer.from(secret)), secret).toBe(false);
  });

  it('takes a capture time without an offset in the household time zone, and drops an implausible one', async () => {
    const world = open();
    const local = await world.gateway.albums.uploadItem('album-sports', asFile(await syntheticPhoto({ dateTimeOriginal: '2026:09:20 09:12:30' }), 'local.jpg', 'image/jpeg'), { keepLocation: true });
    const broken = await world.gateway.albums.uploadItem('album-sports', asFile(await syntheticPhoto({ dateTimeOriginal: '1980:01:01 00:00:00', offsetTimeOriginal: '+09:00' }), 'old.jpg', 'image/jpeg'), { keepLocation: false });
    await settled(world);
    const album = await world.gateway.albums.getAlbum('album-sports');
    const find = (id: string) => (album.ok ? album.value.items.find((item) => item.id === id) : undefined);
    expect(local.ok && find(local.value.itemId)).toMatchObject({ status: 'ready', takenAt: '2026-09-20T09:12:30+09:00', takenAtSource: 'exif-local' });
    const old = broken.ok ? find(broken.value.itemId) : undefined;
    expect(old).toMatchObject({ status: 'ready' });
    expect(old?.takenAt).toBeUndefined();
    expect(old?.takenAtSource).toBeUndefined();
    // 位置がなければ、残す指定でも日時だけを書く。
    const stored = readFileSync(originalPath(world.deps.config.mediaPath, 'house-mori', local.ok ? local.value.itemId : ''));
    const parsed = await exifr.parse(stored, { tiff: true, exif: true, gps: true });
    expect(parsed.latitude).toBeUndefined();
    expect(parsed.Make).toBeUndefined();
  });
});

describe('attachments in memos lose their metadata too (A16)', () => {
  it('re-encodes a photo attachment and scrubs a video attachment', async () => {
    const world = open();
    const photo = await world.gateway.memos.uploadAttachment('memo-school', asFile(await syntheticPhoto({ lat: 35.6, lng: 139.7, dateTimeOriginal: '2026:09:20 09:12:30' }), 'p.jpg', 'image/jpeg'));
    await settled(world);
    const video = await world.gateway.memos.uploadAttachment('memo-school', asFile(syntheticVideo(), 'v.mp4', 'video/mp4'));
    await settled(world);
    for (const uploaded of [photo, video]) {
      const attachment = uploaded.ok ? uploaded.value.attachments.at(-1)! : null;
      const stored = readFileSync(originalPath(world.deps.config.mediaPath, 'house-mori', attachment!.id));
      for (const secret of [...PHOTO_SECRETS, ...VIDEO_SECRETS]) expect(stored.includes(Buffer.from(secret)), secret).toBe(false);
      expect(stored.includes(Buffer.from(LOCATION_TEXT))).toBe(false);
    }
  });
});

describe('the Apple keys builder', () => {
  it('is readable by the scrubber as an mdta meta', async () => {
    const file = Buffer.concat([box('ftyp', Buffer.from('qt  \0\0\0\0qt  ', 'latin1')), box('moov', mvhd(0, 1), mdtaMeta([['com.apple.quicktime.creationdate', CREATION_TEXT]])), box('mdat', Buffer.alloc(8))]);
    expect(await readVideoCaptureTime(tempFile(file), 'Asia/Tokyo', NOW)).toEqual({ takenAt: '2026-09-20T10:15:30+09:00', takenAtSource: 'quicktime-key' });
  });
});
