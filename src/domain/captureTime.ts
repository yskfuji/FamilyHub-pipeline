import type { Rfc3339 } from './types';

/**
 * 写真と動画の撮影日時（A15）。メタデータを消す前に読んだ値から、保存する日時を決める。
 *
 * - exif-offset: 写真の DateTimeOriginal と OffsetTimeOriginal（Exif 2.31）。書かれた時差のまま記録する。
 * - exif-local: 写真の DateTimeOriginal だけ。家族の時間帯の時刻とみなす。
 * - quicktime-key: 動画の com.apple.quicktime.creationdate（時差つきの ISO 8601）。書かれた時差のまま記録する。
 * - mvhd: 動画の mvhd の作成日時（1904-01-01 からの秒数）。UTC とみなし、家族の時間帯で記録する。
 *
 * 0、1990年より前、今より1日を超えて先の値は捨てる（時計の合っていない機器や、壊れた値）。
 */
export const takenAtSources = ['exif-offset', 'exif-local', 'quicktime-key', 'mvhd'] as const;
export type TakenAtSource = typeof takenAtSources[number];
export interface CaptureTime { takenAt: Rfc3339; takenAtSource: TakenAtSource }

const EARLIEST = Date.UTC(1990, 0, 1);
const FUTURE_MS = 86_400_000;
/** 1904-01-01T00:00:00Z から 1970-01-01T00:00:00Z までの秒数。 */
export const MAC_EPOCH_OFFSET_SECONDS = 2_082_844_800;
const MAX_OFFSET_MINUTES = 14 * 60;

const pad = (value: number, size = 2) => String(Math.trunc(Math.abs(value))).padStart(size, '0');

/** 採ってよい日時か。 */
export function plausibleCaptureTime(epochMs: number, now: Date): boolean {
  return Number.isFinite(epochMs) && epochMs >= EARLIEST && epochMs <= now.getTime() + FUTURE_MS;
}

const formatOffset = (minutes: number) => `${minutes < 0 ? '-' : '+'}${pad(Math.abs(minutes) / 60)}:${pad(Math.abs(minutes) % 60)}`;

/** 時間帯の、その瞬間の UTC からのずれ（分）。 */
export function zoneOffsetMinutes(epochMs: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

/** その瞬間を、時間帯の時刻と時差で書く（例: 2026-09-20T10:00:00+09:00）。 */
export function zonedRfc3339(epochMs: number, timeZone: string): Rfc3339 {
  const offset = zoneOffsetMinutes(epochMs, timeZone);
  return `${new Date(Math.floor(epochMs / 1000) * 1000 + offset * 60_000).toISOString().slice(0, 19)}${formatOffset(offset)}`;
}

interface WallTime { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** 存在する日付と時刻か（2月31日や25時を捨てる）。 */
function validWallTime(wall: WallTime) {
  const { year, month, day, hour, minute, second } = wall;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const wallText = (wall: WallTime) => `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;
const wallUtc = (wall: WallTime) => Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

function parseOffset(text: string): number | null {
  if (text === 'Z') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (minutes > 59) return null;
  const total = (hours * 60 + minutes) * (match[1] === '-' ? -1 : 1);
  return Math.abs(total) > MAX_OFFSET_MINUTES ? null : total;
}

/** 家族の時間帯の時刻を、その瞬間（UTC のミリ秒）にする。夏時間の切り替えでも、近いほうの解釈を採る。 */
function localToEpoch(wall: WallTime, timeZone: string) {
  const guess = wallUtc(wall);
  let epoch = guess - zoneOffsetMinutes(guess, timeZone) * 60_000;
  epoch = guess - zoneOffsetMinutes(epoch, timeZone) * 60_000;
  return epoch;
}

/** 写真の DateTimeOriginal（"YYYY:MM:DD HH:MM:SS"）と OffsetTimeOriginal（"+09:00"）から。 */
export function captureTimeFromExif(dateTimeOriginal: string | undefined, offsetTimeOriginal: string | undefined, timeZone: string, now: Date): CaptureTime | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dateTimeOriginal?.trim() ?? '');
  if (!match) return null;
  const wall: WallTime = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]) };
  if (!validWallTime(wall)) return null;
  const offset = offsetTimeOriginal === undefined ? null : parseOffset(offsetTimeOriginal.trim());
  if (offset !== null) {
    const epoch = wallUtc(wall) - offset * 60_000;
    return plausibleCaptureTime(epoch, now) ? { takenAt: `${wallText(wall)}${formatOffset(offset)}`, takenAtSource: 'exif-offset' } : null;
  }
  const epoch = localToEpoch(wall, timeZone);
  return plausibleCaptureTime(epoch, now) ? { takenAt: zonedRfc3339(epoch, timeZone), takenAtSource: 'exif-local' } : null;
}

/** 動画の com.apple.quicktime.creationdate（例: 2026-09-20T10:00:00+0900）。時差のない値は採らない。 */
export function captureTimeFromQuickTime(value: string, now: Date): CaptureTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(value.trim());
  if (!match) return null;
  const wall: WallTime = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]) };
  const offset = parseOffset(match[7]);
  if (offset === null || !validWallTime(wall)) return null;
  const epoch = wallUtc(wall) - offset * 60_000;
  return plausibleCaptureTime(epoch, now) ? { takenAt: `${wallText(wall)}${formatOffset(offset)}`, takenAtSource: 'quicktime-key' } : null;
}

/** 動画の mvhd の creation_time（1904-01-01 からの秒数、UTC とみなす）。 */
export function captureTimeFromMvhd(seconds: number, timeZone: string, now: Date): CaptureTime | null {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  const epoch = (seconds - MAC_EPOCH_OFFSET_SECONDS) * 1000;
  return plausibleCaptureTime(epoch, now) ? { takenAt: zonedRfc3339(epoch, timeZone), takenAtSource: 'mvhd' } : null;
}
