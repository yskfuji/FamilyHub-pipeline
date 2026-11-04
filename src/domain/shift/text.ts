/** 貼り付けた文字をそろえる。全角の数字や記号、時刻の書き方の違いをなくす。 */
export function normalizeRosterText(text: string) {
  return text.normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[〜∼]/g, '~')
    .replace(/[−–—―‐]/g, '-')
    .replace(/(\d)\s*ー\s*(\d)/g, '$1-$2')
    .replace(/令和\s*(\d{1,2})\s*年/g, (_all, year: string) => `${2018 + Number(year)}年`)
    .replace(/(^|[^A-Z0-9])R\s*(\d{1,2})[./年]/g, (_all, head: string, year: string) => `${head}${2018 + Number(year)}年`)
    .replace(/(\d{1,2})時半/g, '$1:30')
    .replace(/(\d{1,2})時(\d{1,2})分?/g, (_all, hour: string, minute: string) => `${hour}:${minute.padStart(2, '0')}`)
    .replace(/(\d{1,2})時/g, '$1:00');
}

export interface Cells { cells: string[]; /** 区切りが表の列を保っているとき。空の列も数える。 */ exact: boolean }

/** 行を列に分ける。タブ・縦棒・カンマは空の列を保ち、空白だけの行は続いた空白を1つに数える。 */
export function cellsOf(line: string): Cells {
  if (line.includes('\t')) return { cells: line.split('\t').map((cell) => cell.trim()), exact: true };
  if (line.includes('|')) return { cells: line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()), exact: true };
  if ((line.match(/,/g) ?? []).length >= 3) return { cells: line.split(',').map((cell) => cell.trim()), exact: true };
  return { cells: line.trim().split(/\s+/).filter(Boolean), exact: false };
}

export interface ClockRange { start: string; end: string; endsNextDay: boolean; text: string }

const RANGE = /(\d{1,2})(?::(\d{2}))?\s*(?:~|-|から)\s*(翌日?)?\s*(\d{1,2})(?::(\d{2}))?(?:まで)?/;
const clock = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** 文字の中の時刻の範囲を読む。24時以降の書き方（22:00-31:00）は翌日の時刻に直す。 */
export function findClockRange(text: string): ClockRange | null {
  const match = RANGE.exec(text);
  if (!match) return null;
  const [all, startHour, startMinute = '00', next, endHour, endMinute = '00'] = match;
  const hours = [Number(startHour), Number(endHour)];
  const minutes = [Number(startMinute), Number(endMinute)];
  if (hours[0] > 29 || hours[1] > 47 || minutes.some((value) => value > 59)) return null;
  const startsNext = hours[0] >= 24;
  const start = clock(hours[0] % 24, minutes[0]);
  const end = clock(hours[1] % 24, minutes[1]);
  const endsNextDay = Boolean(next) || hours[1] >= 24 || (end <= start && !startsNext);
  return { start, end, endsNextDay, text: all };
}

export const weekdayNames = '日月火水木金土';

/** 日付が実在するときだけ YYYY-MM-DD を返す。 */
export function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const weekdayOf = (dateKey: string) => weekdayNames[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];

/** 名前の比べ方。空白と敬称を除く。 */
export const personKey = (name: string) => name.normalize('NFKC').replace(/\s+/g, '').replace(/(さん|様|君|ちゃん)$/, '');

/** 同じ人かどうか。名字だけの指定も認める。 */
export function samePerson(a: string, b: string) {
  const [left, right] = [personKey(a), personKey(b)];
  return Boolean(left && right) && (left === right || left.includes(right) || right.includes(left));
}
