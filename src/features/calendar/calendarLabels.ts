import type { CSSProperties } from 'react';
import { formatDate, formatTime } from '../../design-system/components';
import { lastDateOf, type Occurrence } from '../../domain/calendarLayout';
import { holidaysBetween } from '../../domain/holidays';
import type { ColorLabel } from '../../domain/types';

export const dayLabel = (date: string) => formatDate(`${date}T12:00:00+09:00`);
export const timezoneLabel = (timezone: string) => (timezone === 'Asia/Tokyo' ? '日本時間' : timezone);
export const monthHeading = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}年${month}月`;
};
export const yearDayHeading = (date: string) => `${Number(date.slice(0, 4))}年${dayLabel(date)}`;
export const weekHeading = (dates: readonly string[]) => `${Number(dates[0].slice(0, 4))}年${dayLabel(dates[0]).replace(/\(.\)$/, '')}〜${dayLabel(dates[6]).replace(/\(.\)$/, '')}`;

export const holidayMap = (from: string, to: string): ReadonlyMap<string, string> => new Map(holidaysBetween(from, to).map((holiday) => [holiday.date, holiday.name]));

/** 日の色分け。日曜と祝日は赤、土曜は青。 */
export function dayTone(date: string, holiday: string | undefined): 'holiday' | 'saturday' | undefined {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (holiday || weekday === 0) return 'holiday';
  return weekday === 6 ? 'saturday' : undefined;
}

/** リストの色。色は利用者が決める値なので、文字色ではなく印の色にだけ使う。 */
export function labelStyle(labels: readonly ColorLabel[], id: string | undefined): CSSProperties | undefined {
  const color = id ? labels.find((label) => label.id === id)?.color : undefined;
  return color ? ({ '--event-color': color } as CSSProperties) : undefined;
}

/** 予定の日時の説明。 */
export function whenLabel(occurrence: Occurrence): string {
  const last = lastDateOf(occurrence);
  const multiDay = last > occurrence.occurrenceDate;
  if (occurrence.allDay) return `${dayLabel(occurrence.occurrenceDate)}${multiDay ? `〜${dayLabel(last)}` : ''}（終日）`;
  if (multiDay) return `${dayLabel(occurrence.occurrenceDate)} ${formatTime(occurrence.startsAt)}〜${dayLabel(last)} ${formatTime(occurrence.endsAt)}`;
  return `${dayLabel(occurrence.occurrenceDate)} ${formatTime(occurrence.startsAt)}〜${formatTime(occurrence.endsAt)}`;
}

/** 日の一覧の時刻の欄。 */
export function timeOnDay(occurrence: Occurrence, date: string): string {
  if (occurrence.allDay) return '終日';
  const first = occurrence.occurrenceDate === date;
  const last = lastDateOf(occurrence) === date;
  if (first) return formatTime(occurrence.startsAt);
  return last ? `〜${formatTime(occurrence.endsAt)}` : '終日';
}
