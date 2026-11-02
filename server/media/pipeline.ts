import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { sniff } from './sniff';
import type { SniffResult } from './sniff';
import { stripVideoLocation } from './mp4Location';
import type { Scanner } from '../adapters/scanner';
import { serverMessages } from '../../src/content/serverMessages';

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

export interface ProcessedMedia { width?: number; height?: number; byteSize: number; takenAt?: string; hasThumbnail: boolean }

/** 画像を読み直して保存する。読み直すことで、埋め込まれた位置情報や不要な部分を取り除く。 */
export async function sanitizeImage(source: string, destination: string, keepLocation: boolean) {
  const image = sharp(source, { failOn: 'error' }).rotate();
  const metadata = await sharp(source).metadata();
  await ensureParent(destination);
  if (keepLocation) await rename(source, destination);
  else {
    await (metadata.format === 'png' ? image.png() : image.jpeg({ quality: 92, mozjpeg: true })).toFile(destination);
    await rm(source, { force: true });
  }
  return { width: metadata.width, height: metadata.height };
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

export interface ProcessRequest { root: string; householdId: string; itemId: string; source: string; keepLocation: boolean; scanner: Scanner; findDuplicate(sha256: string): string | null }

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
  try {
    if (type.kind === 'photo') {
      const size = await sanitizeImage(source, destination, keepLocation);
      await writeThumbnail(destination, thumbnailPath(root, householdId, itemId));
      return { status: 'ready', sha256, mimeType: type.mimeType, kind: 'photo', media: { ...size, byteSize: (await stat(destination)).size, hasThumbnail: true } };
    }
    if (!keepLocation) await stripVideoLocation(source);
    await rename(source, destination);
    return { status: 'ready', sha256, mimeType: type.mimeType, kind: 'video', media: { byteSize: (await stat(destination)).size, hasThumbnail: false } };
  } catch {
    await rm(destination, { force: true });
    return reject(type.kind === 'video' ? serverMessages.videoLocationUnknown : serverMessages.imageUnreadable);
  }
}
