// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PHOTO_MAX_BYTES, readGpsFromTiff, readPhotoGps } from './exif';
import { buildGpsTiff, buildHeifWithGps, buildJpegWithGps, buildJpegWithoutGps, seededRandom } from './exif.fixtures';

const fileOf = (bytes: Uint8Array, type = 'image/jpeg', name = 'photo.jpg') => new File([bytes.slice().buffer as ArrayBuffer], name, { type });
const buffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

describe('readPhotoGps', () => {
  it('reads GPS from little-endian JPEG including accuracy and capture time', async () => {
    const result = await readPhotoGps(fileOf(buildJpegWithGps({ accuracyMeters: 12.5, takenAt: { date: '2026:09:29', time: [9, 15, 30] } })));
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.gps.lat).toBeCloseTo(35.64375, 5);
    expect(result.gps.lng).toBeCloseTo(139.66915, 5);
    expect(result.gps.accuracyMeters).toBeCloseTo(12.5, 2);
    expect(result.gps.takenAt).toBe('2026-09-29T09:15:30Z');
  });

  it('reads big-endian JPEG and southern/western hemispheres', async () => {
    const result = await readPhotoGps(fileOf(buildJpegWithGps({ littleEndian: false, lat: -33.8568, lng: -151.2153 })));
    expect(result).toMatchObject({ status: 'found', gps: { lat: expect.closeTo(-33.8568, 4), lng: expect.closeTo(-151.2153, 4) } });
  });

  it('skips an XMP APP1 segment before the Exif segment', async () => {
    const result = await readPhotoGps(fileOf(buildJpegWithGps({ xmpFirst: true })));
    expect(result.status).toBe('found');
  });

  it('reads GPS from a HEIF Exif item', async () => {
    const result = await readPhotoGps(fileOf(buildHeifWithGps(), 'image/heic', 'IMG_0001.HEIC'));
    expect(result).toMatchObject({ status: 'found', gps: { lat: expect.closeTo(35.64375, 5) } });
  });

  it('accepts an empty MIME type only for known photo extensions', async () => {
    expect((await readPhotoGps(fileOf(buildHeifWithGps(), '', 'IMG_0001.heic'))).status).toBe('found');
    expect((await readPhotoGps(fileOf(buildJpegWithGps(), '', 'notes.txt'))).status).toBe('unsupported');
    expect((await readPhotoGps(fileOf(buildJpegWithGps(), 'application/pdf', 'a.pdf'))).status).toBe('unsupported');
  });

  it('reports photos without GPS, zero denominators, and null island as no-gps', async () => {
    expect((await readPhotoGps(fileOf(buildJpegWithoutGps()))).status).toBe('no-gps');
    expect((await readPhotoGps(fileOf(buildJpegWithGps({ zeroDenominator: true })))).status).toBe('no-gps');
    expect((await readPhotoGps(fileOf(buildJpegWithGps({ lat: 0, lng: 0 })))).status).toBe('no-gps');
  });

  it('rejects unsupported formats and oversized files without reading them', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await readPhotoGps(fileOf(png, 'image/png', 'a.png'))).status).toBe('unsupported');
    const large = new Blob([new Uint8Array(1)], { type: 'image/jpeg' });
    Object.defineProperty(large, 'size', { value: PHOTO_MAX_BYTES + 1 });
    expect((await readPhotoGps(large)).status).toBe('too-large');
  });

  it('treats truncated, cyclic, oversized, and out-of-range structures as malformed or absent', async () => {
    const jpeg = buildJpegWithGps();
    expect(['malformed', 'no-gps']).toContain((await readPhotoGps(fileOf(jpeg.slice(0, 40)))).status);
    expect((await readPhotoGps(fileOf(buildJpegWithGps({ gpsPointer: 8 })))).status).toBe('malformed');
    expect((await readPhotoGps(fileOf(buildJpegWithGps({ gpsEntryCount: 65535 })))).status).toBe('malformed');
    expect((await readPhotoGps(fileOf(buildHeifWithGps({ extentOffset: 10_000_000 }), 'image/heic', 'a.heic'))).status).toBe('malformed');
    expect((await readPhotoGps(fileOf(buildHeifWithGps({ constructionMethod: 1 }), 'image/heic', 'a.heic'))).status).toBe('no-gps');
  });

  it('never throws on randomly mutated inputs', async () => {
    const random = seededRandom(20261003);
    const seeds = [buildJpegWithGps({ accuracyMeters: 5, takenAt: { date: '2026:09:29', time: [1, 2, 3] } }), buildHeifWithGps(), buildJpegWithGps({ littleEndian: false })];
    const allowed = new Set(['found', 'no-gps', 'unsupported', 'malformed']);
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const source = seeds[iteration % seeds.length];
      const bytes = source.slice(0, Math.max(4, Math.floor(source.length * (0.5 + random() / 2))));
      const flips = 1 + Math.floor(random() * 8);
      for (let flip = 0; flip < flips; flip += 1) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      const result = await readPhotoGps(fileOf(bytes, iteration % 3 === 1 ? 'image/heic' : 'image/jpeg'));
      expect(allowed.has(result.status)).toBe(true);
      if (result.status === 'found') {
        expect(Math.abs(result.gps.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(result.gps.lng)).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe('readGpsFromTiff', () => {
  it('rejects a byte order mark that is neither II nor MM', () => {
    const tiff = buildGpsTiff();
    tiff[0] = 0x58;
    expect(readGpsFromTiff(buffer(tiff), 0).status).toBe('malformed');
  });

  it('rejects offsets that point outside the buffer', () => {
    expect(readGpsFromTiff(buffer(buildGpsTiff()), 4096).status).toBe('malformed');
  });
});
