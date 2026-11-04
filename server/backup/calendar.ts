import { randomBytes } from 'node:crypto';
import { BACKUP_GENERATIONS } from '../../src/domain/backupRetention';

/**
 * バックアップの世代の名前と、残す世代の選び方（A8-4）。日付は家族の時間帯（既定は Asia/Tokyo）で数える。
 *
 * 世代の ID は `YYYY-MM-DDTHHMMSS-xxxxxx`（その時間帯の作った日時と、6桁の乱数）。並べると作った順になる。
 * 残す世代は、新しい世代を確定した時点の日付から数える:
 * - 日: 今日を含む直近7日の各日の、いちばん新しい世代
 * - 週: 今週（月曜始まり）を含む直近4週の各週の、いちばん古い世代（月曜の実行が失敗した週は、その次に成功した世代）
 * - 月: 今月を含む直近6か月の各月の、いちばん古い世代（1日の実行が失敗した月は、その次に成功した世代）
 * 期間は暦で数えるので、止まっていた期間があっても、6か月より前の世代は残らない。未来の日付の世代（時計の戻り）は消さない。
 */
export const GENERATION_ID = /^(\d{4}-\d{2}-\d{2})T(\d{6})-[0-9a-f]{6}$/;

export interface LocalTime { date: string; time: string; minutes: number; offsetMinutes: number }

export function localTime(at: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const [hour, minute, second] = [Number(parts.hour), Number(parts.minute), Number(parts.second)];
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, minute, second);
  const offsetMinutes = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  return { date, time: `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}${String(second).padStart(2, '0')}`, minutes: hour * 60 + minute, offsetMinutes };
}

/** 時間帯の名前が使えるか（設定の確認）。 */
export function isTimeZone(timeZone: string) {
  try { new Intl.DateTimeFormat('en-CA', { timeZone }); return true; } catch { return false; }
}

export function rfc3339(at: Date, timeZone: string) {
  const local = localTime(at, timeZone);
  const offset = Math.abs(local.offsetMinutes);
  const sign = local.offsetMinutes < 0 ? '-' : '+';
  return `${local.date}T${local.time.slice(0, 2)}:${local.time.slice(2, 4)}:${local.time.slice(4, 6)}${sign}${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`;
}

export function newGenerationId(at: Date, timeZone: string) {
  const local = localTime(at, timeZone);
  return `${local.date}T${local.time}-${randomBytes(3).toString('hex')}`;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
/** 月曜を0とする、その週の月曜の日の番号。 */
const weekNumber = (date: string) => { const day = dayNumber(date); return day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7); };
const monthNumber = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

export type Tier = 'daily' | 'weekly' | 'monthly';

/** 残す世代と、それぞれが残る理由。今日（today、YYYY-MM-DD）から暦で数える。 */
export function generationsToKeep(ids: readonly string[], today: string, counts: { daily: number; weekly: number; monthly: number } = BACKUP_GENERATIONS): Map<string, Tier[]> {
  const parsed = ids.map((id) => ({ id, date: GENERATION_ID.exec(id)?.[1] })).filter((item): item is { id: string; date: string } => Boolean(item.date)).sort((a, b) => a.id.localeCompare(b.id));
  const kept = new Map<string, Tier[]>();
  const mark = (id: string, tier: Tier) => kept.set(id, [...(kept.get(id) ?? []), tier]);
  const pick = (tier: Tier, period: (date: string) => number, count: number, newest: boolean) => {
    const current = period(today);
    const chosen = new Map<number, string>();
    for (const item of parsed) {
      const value = period(item.date);
      if (value > current || value <= current - count) continue;
      if (newest || !chosen.has(value)) chosen.set(value, item.id);
    }
    for (const id of chosen.values()) mark(id, tier);
  };
  pick('daily', dayNumber, counts.daily, true);
  pick('weekly', (date) => weekNumber(date) / 7, counts.weekly, false);
  pick('monthly', monthNumber, counts.monthly, false);
  for (const item of parsed) if (dayNumber(item.date) > dayNumber(today) && !kept.has(item.id)) kept.set(item.id, []);
  return kept;
}
