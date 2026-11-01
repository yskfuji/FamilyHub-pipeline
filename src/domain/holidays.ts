import { addDateKeyDays } from './calendarDate';
import type { IsoDate } from './types';

export interface Holiday { date: IsoDate; name: string }

/** 祝日法の現行の規則で計算する範囲。春分と秋分の近似式の有効範囲に合わせ、これより外は空を返す（推測しない）。 */
export const HOLIDAY_RANGE = { from: 2007, to: 2099 } as const;

const pad = (value: number) => String(value).padStart(2, '0');
const key = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const weekday = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).getUTCDay();

/** 月の第 n 月曜日の日。 */
function nthMonday(year: number, month: number, nth: number) {
  const first = weekday(key(year, month, 1));
  return 1 + ((8 - first) % 7) + (nth - 1) * 7;
}

const equinoxDay = (year: number, base: number) => Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));

function namedHolidays(year: number): Map<string, string> {
  const days = new Map<string, string>();
  const set = (month: number, day: number, name: string) => days.set(key(year, month, day), name);
  set(1, 1, '元日');
  set(1, nthMonday(year, 1, 2), '成人の日');
  set(2, 11, '建国記念の日');
  if (year >= 2020) set(2, 23, '天皇誕生日'); else if (year <= 2018) set(12, 23, '天皇誕生日');
  set(3, equinoxDay(year, 20.8431), '春分の日');
  set(4, 29, '昭和の日');
  set(5, 3, '憲法記念日');
  set(5, 4, 'みどりの日');
  set(5, 5, 'こどもの日');
  if (year === 2020) { set(7, 23, '海の日'); set(7, 24, 'スポーツの日'); set(8, 10, '山の日'); }
  else if (year === 2021) { set(7, 22, '海の日'); set(7, 23, 'スポーツの日'); set(8, 8, '山の日'); }
  else {
    set(7, nthMonday(year, 7, 3), '海の日');
    if (year >= 2016) set(8, 11, '山の日');
    set(10, nthMonday(year, 10, 2), year >= 2020 ? 'スポーツの日' : '体育の日');
  }
  set(9, nthMonday(year, 9, 3), '敬老の日');
  set(9, equinoxDay(year, 23.2488), '秋分の日');
  set(11, 3, '文化の日');
  set(11, 23, '勤労感謝の日');
  if (year === 2019) { set(5, 1, '天皇の即位の日'); set(10, 22, '即位礼正殿の儀の行われる日'); }
  return days;
}

/** その年の祝日。振替休日と、祝日に挟まれた国民の休日を含む。日付の順に返す。 */
export function holidaysOfYear(year: number): Holiday[] {
  if (year < HOLIDAY_RANGE.from || year > HOLIDAY_RANGE.to) return [];
  const days = namedHolidays(year);
  for (const date of [...days.keys()].sort()) {
    if (weekday(date) !== 0) continue;
    let substitute = addDateKeyDays(date, 1);
    while (days.has(substitute)) substitute = addDateKeyDays(substitute, 1);
    days.set(substitute, '振替休日');
  }
  for (const date of [...days.keys()].sort()) {
    const between = addDateKeyDays(date, 1);
    if (!days.has(between) && days.has(addDateKeyDays(date, 2)) && weekday(between) !== 0 && between.startsWith(`${year}-`)) days.set(between, '国民の休日');
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, name]) => ({ date: date as IsoDate, name }));
}

/** [fromKey, toKey] の祝日。 */
export function holidaysBetween(fromKey: string, toKey: string): Holiday[] {
  const result: Holiday[] = [];
  for (let year = Number(fromKey.slice(0, 4)); year <= Number(toKey.slice(0, 4)); year += 1) {
    result.push(...holidaysOfYear(year).filter((item) => item.date >= fromKey && item.date <= toKey));
  }
  return result;
}
