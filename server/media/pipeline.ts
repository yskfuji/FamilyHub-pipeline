import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { sniff } from './sniff';
import type { SniffResult } from './sniff';
import { readVideoCaptureTime, scrubVideoMetadata, UnsupportedVideoMetadata } from './mp4Metadata';
import type { Scanner } from '../adapters/scanner';
import { serverMessages } from '../../src/content/serverMessages';
import { captureTimeFromExif } from '../../src/domain/captureTime';
import type { CaptureTime, TakenAtSource } from '../../src/domain/captureTime';
import { readPhotoFacts } from '../../src/domain/exifTiff';
import type { PhotoFacts } from '../../src/domain/exifTiff';

export const quarantinePath = (root: string, id: string) => join(root, 'quarantine', id);
export const originalPath = (root: string, householdId: string, id: string) => join(root, householdId, id, 'original');
export const thumbnailPath = (root: string, householdId: string, id: string) => join(root, householdId, id, 'thumbnail.jpg');

export async function ensureParent(path: string) { await mkdir(dirname(path), { recursive: true }); }

export async function sniffFile(path: string): Promise<SniffResult> {
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(64);
    const { bytesRead } = await file.read(head, 0, 64, 0);
    return sniff(head.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
}

export async function sha256File(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface ProcessedMedia { width?: number; height?: number; byteSize: number; takenAt?: string; takenAtSource?: TakenAtSource; hasThumbnail: boolean }

/** 角度・分・秒（秒は 1/1000 まで）の有理数の並び。sharp の withExif が読む形（"35/1 39/1 29340/1000"）。 */
function dms(value: number) {
  const total = Math.round(Math.abs(value) * 3_600_000);
  const degrees = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total - degrees * 3_600_000) / 60_000);
  return `${degrees}/1 ${minutes}/1 ${total - degrees * 3_600_000 - minutes * 60_000}/1000`;
}

/**
 * 位置を残すときに書く、最小の EXIF（A16）。GPS（緯度・経度・高度）と撮影日時と時差だけを書く。
 * 機種・ソフトウェア・シリアル・メーカーの独自の情報・縮小画像は書かない（sharp は入力の EXIF を使わず、これだけを書く）。
 * libexif は形式に必要な項目（解像度・版・色空間・画素数）を足すが、人や機器を特定する値は含まない。
 */
export function minimalExif(facts: PhotoFacts): Record<string, Record<string, string>> | null {
  const exif: Record<string, Record<string, string>> = {};
  if (facts.gps) {
    const { lat, lng, altitude } = facts.gps;
    exif.IFD3 = {
      GPSLatitudeRef: lat < 0 ? 'S' : 'N', GPSLatitude: dms(lat), GPSLongitudeRef: lng < 0 ? 'W' : 'E', GPSLongitude: dms(lng),
      ...(altitude === undefined ? {} : { GPSAltitudeRef: altitude < 0 ? '1' : '0', GPSAltitude: `${Math.round(Math.abs(altitude) * 100)}/100` }),
    };
  }
  if (facts.dateTimeOriginal) exif.IFD2 = { DateTimeOriginal: facts.dateTimeOriginal, ...(facts.offsetTimeOriginal ? { OffsetTimeOriginal: facts.offsetTimeOriginal } : {}) };
  return Object.keys(exif).length ? exif : null;
}

export interface CaptureContext { timeZone: string; now: Date }

/** 写真の EXIF から、撮影日時（A15）と位置。読めなければ空。 */
export async function readImageFacts(source: string): Promise<PhotoFacts> {
  const { exif } = await sharp(source).metadata();
  return exif ? readPhotoFacts(exif) : {};
}

/**
 * 画像を、回転を当ててから必ず再エンコードして保存する（A16）。元のファイルはそのまま保存しない。
 * 撮影日時はメタデータを消す前に読む（A15）。位置を残すときだけ、最小の EXIF を書く。
 */
export async function sanitizeImage(source: string, destination: string, options: { keepLocation: boolean } & CaptureContext): Promise<{ width?: number; height?: number; capture: CaptureTime | null }> {
  const facts = await readImageFacts(source);
  const capture = captureTimeFromExif(facts.dateTimeOriginal, facts.offsetTimeOriginal, options.timeZone, options.now);
  const { format } = await sharp(source).metadata();
  await ensureParent(destination);
  const exif = options.keepLocation ? minimalExif(facts) : null;
  let image = sharp(source, { failOn: 'error' }).rotate();
  if (exif) {
    // withExif は入力の EXIF の塊（縮小画像など）を引き継ぐことがあるので、画素だけにしてから書く。
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    image = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  }
  image = format === 'png' ? image.png() : image.jpeg({ quality: 92, mozjpeg: true });
  if (exif) image = image.withExif(exif);
  const written = await image.toFile(destination);
  await rm(source, { force: true });
  return { width: written.width, height: written.height, capture };
}

export async function writeThumbnail(source: string, destination: string) {
  await ensureParent(destination);
  await sharp(source, { failOn: 'error' }).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(destination);
}

/** 動画の縮小画像は端末で作ったものを受け取る。信用できない入力として読み直す。 */
export async function acceptClientThumbnail(bytes: Buffer, destination: string) {
  await ensureParent(destination);
  await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(destination);
}

export type ProcessOutcome = { status: 'ready'; media: ProcessedMedia; sha256: string; mimeType: string; kind: 'photo' | 'video' } | { status: 'duplicate'; existingId: string } | { status: 'rejected'; message: string };

export interface ProcessRequest extends CaptureContext { root: string; householdId: string; itemId: string; source: string; keepLocation: boolean; scanner: Scanner; findDuplicate(sha256: string): string | null }

/** 受け取ったファイルの判定・検査・無害化。どの段階でも問題があれば保存しない。 */
export async function processMedia(request: ProcessRequest): Promise<ProcessOutcome> {
  const { root, householdId, itemId, source, keepLocation, scanner } = request;
  const reject = async (message: string): Promise<ProcessOutcome> => { await rm(source, { force: true }); return { status: 'rejected', message }; };
  const type = await sniffFile(source);
  if ('rejected' in type) return reject(type.rejected === 'heic' ? serverMessages.heicRejected : serverMessages.fileTypeRejected);
  if (type.kind === 'document') return reject(serverMessages.albumMediaOnly);
  const sha256 = await sha256File(source);
  const duplicate = request.findDuplicate(sha256);
  if (duplicate) { await rm(source, { force: true }); return { status: 'duplicate', existingId: duplicate }; }
  if (await scanner.scan(source) !== 'clean') return reject(serverMessages.mediaNotSafe);
  const destination = originalPath(root, householdId, itemId);
  await ensureParent(destination);
  const captured = (capture: CaptureTime | null) => (capture ? { takenAt: capture.takenAt, takenAtSource: capture.takenAtSource } : {});
  try {
    if (type.kind === 'photo') {
      const { capture, ...size } = await sanitizeImage(source, destination, { keepLocation, timeZone: request.timeZone, now: request.now });
      await writeThumbnail(destination, thumbnailPath(root, householdId, itemId));
      return { status: 'ready', sha256, mimeType: type.mimeType, kind: 'photo', media: { ...size, ...captured(capture), byteSize: (await stat(destination)).size, hasThumbnail: true } };
    }
    // 日時は消す前に読む。消せないメタデータがあれば保存しない。
    const capture = await readVideoCaptureTime(source, request.timeZone, request.now);
    await scrubVideoMetadata(source, { keepLocation });
    await rename(source, destination);
    return { status: 'ready', sha256, mimeType: type.mimeType, kind: 'video', media: { ...captured(capture), byteSize: (await stat(destination)).size, hasThumbnail: false } };
  } catch (error) {
    await rm(destination, { force: true });
    if (error instanceof UnsupportedVideoMetadata) return reject(serverMessages.videoMetadataUnsupported);
    return reject(type.kind === 'video' ? serverMessages.videoLocationUnknown : serverMessages.imageUnreadable);
  }
}
