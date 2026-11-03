import { addDateKeyDays, dateKeyFromRfc3339 } from './calendarDate';
import { describeRule, occurrenceStartsAt, parseRRule } from './recurrence';
import type { CalendarEvent, IsoDate, OccurrenceDeletion, RecurrenceRule } from './types';
import { seriesShiftCopy } from '../content/ja';

/**
 * 繰り返しの「すべて」の編集で日付を変えるとき、シリーズ全体を同じ日数だけずらす（A13）。
 * ずらした後の回の集合が、元の回の集合を deltaDays だけずらしたものと必ず一致する規則だけを受け付け、
 * それ以外は理由を返す（推測でずらさない）。画面はこの理由を文に直し、「これ以降の予定」を案内する。
 *
 * - DAILY: いつでもずらせる。
 * - WEEKLY: INTERVAL=1、または回した後の曜日が、開始日の週（日曜はじまり）の境を越えないとき。
 *   展開は開始日の週の日曜を起点に INTERVAL 週ごとに数えるため、境を越える曜日があると隔週の組がずれる。
 * - MONTHLY: 日付で決まる規則のうち、元の日とずらした後の日がすべて1〜28日に収まるとき（どの月にもある日だけ）。
 *   月末（29〜31日）と BYSETPOS は、月の長さで回が変わるので受け付けない。
 * 開始・終了・例外日・UNTIL・1回だけ削除した記録を同じだけずらし、COUNT は変えない。
 */
export type SeriesShiftRefusal = 'month-end' | 'set-position' | 'crosses-week' | 'out-of-range' | 'unsupported';
export type SeriesShift = { ok: true; event: CalendarEvent } | { ok: false; reason: SeriesShiftRefusal };

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const weekday = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();
const dayOfMonth = (dateKey: string) => Number(dateKey.slice(8, 10));
const inSafeMonthDays = (day: number) => day >= 1 && day <= 28;
const mod7 = (value: number) => ((value % 7) + 7) % 7;

/** 日付の差（日）。from から to まで。 */
export const daysBetweenKeys = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** 日時を、時刻と時差を保ったまま日付だけずらす。 */
const shiftInstant = (value: string, deltaDays: number) => occurrenceStartsAt(value, addDateKeyDays(dateKeyFromRfc3339(value), deltaDays));

/** 規則がずらせるか。ずらせなければ理由。 */
export function seriesShiftRefusal(startKey: string, recurrence: RecurrenceRule, deltaDays: number): SeriesShiftRefusal | null {
  const rule = parseRRule(recurrence.rrule);
  if (!rule) return 'unsupported';
  if (deltaDays === 0 || rule.freq === 'DAILY') return null;
  if (rule.freq === 'WEEKLY') {
    if (rule.interval === 1 || rule.byDay.length === 0) return null;
    const anchorWeek = Math.floor((weekday(startKey) + deltaDays) / 7);
    return rule.byDay.every((day) => Math.floor((day + deltaDays) / 7) === anchorWeek) ? null : 'crosses-week';
  }
  if (!rule.byMonthDay.length) {
    const day = dayOfMonth(startKey);
    if (day > 28) return 'month-end';
    return inSafeMonthDays(day + deltaDays) ? null : 'out-of-range';
  }
  if (rule.byMonthDay.some((day) => day > 28)) return 'month-end';
  if (rule.bySetPos !== undefined) return 'set-position';
  if (!rule.byMonthDay.every((day) => inSafeMonthDays(day + deltaDays))) return 'out-of-range';
  // 開始日の月から INTERVAL か月ごとに数えるので、開始日が別の月へ移ると組がずれる。
  return addDateKeyDays(startKey, deltaDays).slice(0, 7) === startKey.slice(0, 7) ? null : 'out-of-range';
}

/** RRULE の BYDAY・BYMONTHDAY・UNTIL を deltaDays だけずらす。ほかの項目（COUNT を含む）は変えない。 */
function shiftRRule(rrule: string, deltaDays: number): string {
  return rrule.split(';').map((part) => {
    const [key, value] = part.split('=');
    if (key === 'BYDAY') return `BYDAY=${value.split(',').map((code) => DAY_CODES[mod7(DAY_CODES.indexOf(code as typeof DAY_CODES[number]) + deltaDays)]).join(',')}`;
    if (key === 'BYMONTHDAY') return `BYMONTHDAY=${value.split(',').map((day) => Number(day) + deltaDays).join(',')}`;
    if (key === 'UNTIL') {
      const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
      return `UNTIL=${addDateKeyDays(date, deltaDays).replaceAll('-', '')}${value.slice(8)}`;
    }
    return part;
  }).join(';');
}

/** シリーズ全体を deltaDays 日ずらす。分けた後のシリーズは別の予定なので、ここでは扱わない。 */
export function shiftSeries(event: CalendarEvent, deltaDays: number): SeriesShift {
  const startKey = dateKeyFromRfc3339(event.startsAt);
  if (event.recurrence) {
    const refusal = seriesShiftRefusal(startKey, event.recurrence, deltaDays);
    if (refusal) return { ok: false, reason: refusal };
  }
  const shifted = structuredClone(event);
  if (deltaDays === 0) return { ok: true, event: shifted };
  shifted.startsAt = shiftInstant(event.startsAt, deltaDays);
  shifted.endsAt = shiftInstant(event.endsAt, deltaDays);
  if (event.recurrence) {
    shifted.recurrence = {
      ...event.recurrence,
      rrule: shiftRRule(event.recurrence.rrule, deltaDays),
      exceptions: event.recurrence.exceptions.map((date) => addDateKeyDays(date, deltaDays) as IsoDate),
    };
  }
  return { ok: true, event: shifted };
}

/** 1回だけ削除した記録のうち、このシリーズの分を同じだけずらす（最近削除から戻せるように）。 */
export function shiftOccurrenceDeletions(deletions: readonly OccurrenceDeletion[], eventId: string, deltaDays: number): OccurrenceDeletion[] {
  return deletions.map((item) => item.eventId === eventId && deltaDays !== 0 ? { ...item, occurrenceDate: addDateKeyDays(item.occurrenceDate, deltaDays) as IsoDate } : item);
}

/** 拒否の理由を、利用者に見せる文にする。「これ以降の予定」への案内を含む。 */
export const seriesShiftRefusalMessage = (reason: SeriesShiftRefusal) => `${seriesShiftCopy.refusal[reason]}${seriesShiftCopy.pointer}`;

/**
 * 保存の前に示す文（例:「すべての予定を1日後へ移します（毎週木曜）」）。
 * 日付が変わらないときと、ずらせないときは null（ずらせないときは seriesShiftRefusalMessage を使う）。
 */
export function describeSeriesShift(event: CalendarEvent, deltaDays: number): string | null {
  if (deltaDays === 0 || !event.recurrence) return null;
  const shifted = shiftSeries(event, deltaDays);
  if (!shifted.ok || !shifted.event.recurrence) return null;
  return seriesShiftCopy.confirm(deltaDays, describeRule(dateKeyFromRfc3339(shifted.event.startsAt), shifted.event.recurrence));
}
