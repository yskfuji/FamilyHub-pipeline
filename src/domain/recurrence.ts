import { addDateKeyDays } from './calendarDate';
import type { IsoDate, RecurrenceRule } from './types';

/**
 * 繰り返し規則（RFC 5545 RRULE の一部: FREQ=DAILY/WEEKLY/MONTHLY, INTERVAL, BYDAY, UNTIL, COUNT）を、表示する範囲の分だけ日付に展開する。
 * 対応しない規則は null を返し、呼び出し側は最初の1回だけを扱う（推測で展開しない）。
 */

export interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  byDay: number[];
  until?: string;
  count?: number;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const MAX_ITERATIONS = 3660;

export function parseRRule(rrule: string): ParsedRule | null {
  const parts = new Map(rrule.split(';').map((part) => part.split('=') as [string, string]));
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
  for (const key of parts.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT'].includes(key)) return null;
  const interval = Number(parts.get('INTERVAL') ?? '1');
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  const byDayRaw = parts.get('BYDAY');
  const byDay = byDayRaw ? byDayRaw.split(',').map((code) => DAY_CODES.indexOf(code as typeof DAY_CODES[number])) : [];
  if (byDay.some((value) => value < 0) || (byDay.length && freq !== 'WEEKLY')) return null;
  const untilRaw = parts.get('UNTIL');
  const until = untilRaw ? untilRaw.match(/^(\d{4})(\d{2})(\d{2})/)?.slice(1).join('-') : undefined;
  if (untilRaw && !until) return null;
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) return null;
  return { freq, interval, byDay: [...new Set(byDay)].sort(), until, count };
}

const weekday = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();

function* candidates(startKey: string, rule: ParsedRule): Generator<string> {
  if (rule.freq === 'DAILY') {
    for (let i = 0; i < MAX_ITERATIONS; i += 1) yield addDateKeyDays(startKey, i * rule.interval);
    return;
  }
  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length ? rule.byDay : [weekday(startKey)];
    const weekStart = addDateKeyDays(startKey, -weekday(startKey));
    for (let week = 0; week < MAX_ITERATIONS; week += rule.interval) {
      for (const day of days) {
        const date = addDateKeyDays(weekStart, week * 7 + day);
        if (date >= startKey) yield date;
      }
    }
    return;
  }
  const [year, month, day] = startKey.split('-').map(Number);
  for (let i = 0; i < MAX_ITERATIONS / 10; i += 1) {
    const shifted = new Date(Date.UTC(year, month - 1 + i * rule.interval, day));
    if (shifted.getUTCDate() !== day) continue; // 31日などがない月は飛ばす（RFC 5545 と同じ扱い）
    yield shifted.toISOString().slice(0, 10);
  }
}

/** 開始日から規則に従う日付のうち、[fromKey, toKey] に入り、例外日を除いたもの。 */
export function occurrenceDates(startKey: string, recurrence: RecurrenceRule, fromKey: string, toKey: string): string[] {
  const rule = parseRRule(recurrence.rrule);
  if (!rule) return startKey >= fromKey && startKey <= toKey ? [startKey] : [];
  const exceptions = new Set<string>(recurrence.exceptions);
  const result: string[] = [];
  let produced = 0;
  for (const date of candidates(startKey, rule)) {
    if (rule.until && date > rule.until) break;
    if (rule.count !== undefined && produced >= rule.count) break;
    produced += 1; // COUNT は例外日を除く前の回数で数える（RFC 5545）
    if (date > toKey) break;
    if (date >= fromKey && !exceptions.has(date)) result.push(date);
  }
  return result;
}

export function isOccurrence(startKey: string, recurrence: RecurrenceRule, dateKey: string): boolean {
  return occurrenceDates(startKey, recurrence, dateKey, dateKey).length === 1;
}

/** dateKey より後の最初の回。なければ null。 */
export function nextOccurrenceAfter(startKey: string, recurrence: RecurrenceRule, dateKey: string): string | null {
  return occurrenceDates(startKey, recurrence, addDateKeyDays(dateKey, 1), addDateKeyDays(dateKey, 800))[0] ?? null;
}

/** 規則の UNTIL を置き換える（COUNT は外す）。「これ以降」を分けるとき、元のシリーズを前日で終える。 */
export function withUntil(rrule: string, untilKey: string): string {
  const kept = rrule.split(';').filter((part) => !part.startsWith('UNTIL=') && !part.startsWith('COUNT='));
  return [...kept, `UNTIL=${untilKey.replaceAll('-', '')}`].join(';');
}

/** 分割した後半のシリーズの規則。COUNT があれば、前半で消化した回数を差し引く。 */
export function remainderRule(startKey: string, recurrence: RecurrenceRule, splitKey: string): string {
  const rule = parseRRule(recurrence.rrule);
  if (!rule?.count) return recurrence.rrule;
  const before = occurrenceDates(startKey, { ...recurrence, exceptions: [] }, startKey, addDateKeyDays(splitKey, -1)).length;
  const rest = Math.max(1, rule.count - before);
  return recurrence.rrule.split(';').map((part) => (part.startsWith('COUNT=') ? `COUNT=${rest}` : part)).join(';');
}

/** 「毎週水曜」「2週間ごと（火・木）」「毎月15日」などの表示名。対応しない規則は「繰り返し」。 */
export function describeRule(startKey: string, recurrence: RecurrenceRule): string {
  const rule = parseRRule(recurrence.rrule);
  if (!rule) return '繰り返し';
  const days = (rule.byDay.length ? rule.byDay : [weekday(startKey)]).map((day) => DAY_LABELS[day]).join('・');
  const base = rule.freq === 'DAILY' ? (rule.interval === 1 ? '毎日' : `${rule.interval}日ごと`)
    : rule.freq === 'WEEKLY' ? (rule.interval === 1 ? `毎週${days}曜` : `${rule.interval}週間ごと（${days}曜）`)
      : `${rule.interval === 1 ? '毎月' : `${rule.interval}か月ごと`}${Number(startKey.slice(8, 10))}日`;
  if (rule.until) return `${base}・${Number(rule.until.slice(5, 7))}月${Number(rule.until.slice(8, 10))}日まで`;
  if (rule.count) return `${base}・${rule.count}回`;
  return base;
}

/** 回の開始日時。元の日時の時刻と時差（+09:00）をそのまま使う。 */
export const occurrenceStartsAt = (originalStartsAt: string, dateKey: IsoDate | string) => `${dateKey}${originalStartsAt.slice(10)}`;
