import { MEDIA_LIMITS } from './mediaLimits';
import type { Id } from './types';

/** 同時に送れる数。受け取る側の上限と同じ。 */
export const MAX_SIMULTANEOUS_UPLOADS = 3;

/** ファイルを選ぶ欄の指定。 */
export const albumAccept = 'image/jpeg,image/png,video/mp4,video/quicktime';
const acceptedTypes = new Set(albumAccept.split(','));
const typeByExtension: Readonly<Record<string, string>> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', mov: 'video/quicktime' };

export const HEIC_MESSAGE = 'HEIC の写真は受け付けていません。JPEG で保存し直してください。';

/** ブラウザが種類を渡さないことがあるので、そのときは拡張子で判断する。 */
export const albumFileType = (file: Pick<File, 'name' | 'type'>) => file.type || (typeByExtension[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '');

/** 送っても受け付けられないファイルの理由。問題がなければ null。 */
export function albumFileProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const type = albumFileType(file);
  if (/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(file.name)) return HEIC_MESSAGE;
  if (!acceptedTypes.has(type)) return 'JPEG・PNG・MP4・MOV のファイルを選んでください。';
  if (file.size <= 0) return '中身のないファイルは追加できません。';
  if (type.startsWith('video/')) return file.size > MEDIA_LIMITS.videoBytes ? '動画は4GBまでです。' : null;
  return file.size > MEDIA_LIMITS.photoBytes ? '写真は100MBまでです。' : null;
}

export type UploadState = 'staged' | 'waiting' | 'sending' | 'processing' | 'done' | 'duplicate' | 'rejected' | 'failed';

export interface UploadEntry {
  key: string;
  albumId: Id;
  file: File;
  keepLocation: boolean;
  state: UploadState;
  sentBytes: number;
  itemId?: Id;
  message?: string;
  /** 送り直せる失敗か。 */
  retryable: boolean;
  processingSince?: number;
}

type EntryState = Pick<UploadEntry, 'state'>;

/** 待ち行列の中で、送る前のファイルを1つ前か後へ動かす。 */
export function moveStaged<T extends EntryState & Pick<UploadEntry, 'key' | 'albumId'>>(entries: readonly T[], key: string, step: -1 | 1): T[] {
  const target = entries.find((entry) => entry.key === key);
  const staged = entries.filter((entry) => entry.state === 'staged' && entry.albumId === target?.albumId);
  const neighbor = target && staged[staged.indexOf(target) + step];
  if (!target || !neighbor || target.state !== 'staged') return [...entries];
  return entries.map((entry) => (entry === target ? neighbor : entry === neighbor ? target : entry));
}

/** 次に送るファイル。受け取った側の処理が終わるまでは、上限の数に入る。 */
export function nextToSend<T extends EntryState>(entries: readonly T[], limit = MAX_SIMULTANEOUS_UPLOADS): T[] {
  const active = entries.filter((entry) => entry.state === 'sending' || entry.state === 'processing').length;
  return entries.filter((entry) => entry.state === 'waiting').slice(0, Math.max(0, limit - active));
}

export function summarizeUploads(entries: readonly EntryState[]) {
  const count = (...states: UploadState[]) => entries.filter((entry) => states.includes(entry.state)).length;
  const staged = count('staged');
  const finished = count('done', 'duplicate');
  return { staged, finished, duplicates: count('duplicate'), failed: count('failed', 'rejected'), active: count('waiting', 'sending', 'processing'), total: entries.length - staged };
}

/** ここで示す進み具合。受け取り後の処理の間は 100% のままにする。 */
export const uploadPercent = (sentBytes: number, totalBytes: number) => (totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 0);
