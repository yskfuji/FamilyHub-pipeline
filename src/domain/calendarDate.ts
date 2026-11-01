const TOKYO_TIME_ZONE = 'Asia/Tokyo';

export type CalendarGridDate = { date: string; day: number; inCurrentMonth: boolean };

const pad2 = (value: number) => String(value).padStart(2, '0');

export function isMonthKey(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const [year, month] = value.split('-').map(Number);
  return year >= 1900 && year <= 2100 && month >= 1 && month <= 12;
}

export function monthKeyFromRfc3339(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('年月を取得できませんでした。');
  return `${year}-${month}`;
}

export function dateKeyFromRfc3339(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  if (!isMonthKey(monthKey)) throw new Error('年月はYYYY-MM形式で指定してください。');
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}`;
}

export function addDateKeyDays(dateKey: string, delta: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function monthGrid(monthKey: string): CalendarGridDate[] {
  if (!isMonthKey(monthKey)) throw new Error('年月はYYYY-MM形式で指定してください。');
  const [year, month] = monthKey.split('-').map(Number);
  const first = `${monthKey}-01`;
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const gridStart = addDateKeyDays(first, -firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDateKeyDays(gridStart, index);
    return { date, day: Number(date.slice(8, 10)), inCurrentMonth: date.startsWith(`${monthKey}-`) };
  });
}

export function weekDates(anchorDateKey: string): string[] {
  const [year, month, day] = anchorDateKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const start = addDateKeyDays(anchorDateKey, -weekday);
  return Array.from({ length: 7 }, (_, index) => addDateKeyDays(start, index));
}

export function normalizeSelectedDate(selected: string | null, monthKey: string): string | null {
  return selected?.startsWith(`${monthKey}-`) ? selected : null;
}

export function calendarMonthFromUrl(urlLike: string, fallbackMonthKey: string): string {
  const url = new URL(urlLike, 'http://localhost');
  const requested = url.searchParams.get('month');
  return isMonthKey(requested) ? requested : fallbackMonthKey;
}

/** 日本時間のオフセット付き RFC 3339（例: 2026-09-30T07:45:00+09:00）。 */
export function toJstRfc3339(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}

/** カレンダーの表示方式。一覧は日ごとに切れ目なく読む表示。 */
export const calendarViews = ['month', 'week', 'day', 'list'] as const;
export type CalendarView = typeof calendarViews[number];
export const isCalendarView = (value: string | null): value is CalendarView => calendarViews.includes(value as CalendarView);

export function isDateKey(value: string | null): value is string {
  return Boolean(value) && /^\d{4}-\d{2}-\d{2}$/.test(value as string) && isMonthKey((value as string).slice(0, 7)) && addDateKeyDays(value as string, 0) === value;
}

/** カレンダーの画面の状態。URL の ?view= ?month= ?on= と対応する。 */
export interface CalendarLocation { view: CalendarView; monthKey: string; selected: string | null }

export function readCalendarLocation(urlLike: string, todayKey: string, fallbackView: CalendarView): CalendarLocation {
  const params = new URL(urlLike, 'http://localhost').searchParams;
  const view = params.get('view');
  const on = params.get('on');
  const selected = isDateKey(on) ? on : null;
  const monthKey = calendarMonthFromUrl(urlLike, selected?.slice(0, 7) ?? todayKey.slice(0, 7));
  return { view: isCalendarView(view) ? view : fallbackView, monthKey, selected: selected ?? normalizeSelectedDate(todayKey, monthKey) };
}

/** 状態を URL にする。既定と同じ値は書かず、ほかの項目（actor など）は残す。occurrenceDate はその回を必ず ?on= で示す。 */
export function writeCalendarLocation(urlLike: string, location: CalendarLocation, todayKey: string, path = '/calendar', occurrenceDate?: string): string {
  const url = new URL(urlLike, 'http://localhost');
  const set = (name: string, value: string | null) => { if (value) url.searchParams.set(name, value); else url.searchParams.delete(name); };
  const on = occurrenceDate ?? location.selected;
  set('view', location.view === 'month' ? null : location.view);
  set('month', location.monthKey === todayKey.slice(0, 7) ? null : location.monthKey);
  set('on', occurrenceDate || (on && on !== todayKey) ? on : null);
  return `${path}${url.search}`;
}
