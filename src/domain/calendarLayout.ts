import { addDateKeyDays, dateKeyFromRfc3339, monthGrid, type CalendarGridDate } from './calendarDate';
import { occurrenceDates, occurrenceStartsAt } from './recurrence';
import type { CalendarEvent, Expense, IsoDate, Todo } from './types';

/** 繰り返しを展開した1回分。startsAt / endsAt はその回の日時で、occurrenceDate はその回の始まりの日。 */
export type Occurrence = CalendarEvent & { occurrenceDate: IsoDate };

export const MINUTES_IN_DAY = 24 * 60;
/** 時間軸の予定の最小の長さ。短い予定でも押せる高さを保ち、重なりもこの長さで判定する。 */
export const MIN_BLOCK_MINUTES = 45;

const dayGap = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** 日本時間の、その日の始まりからの分。 */
export const minutesOfDay = (iso: string) => Math.floor((Date.parse(iso) + 9 * 3_600_000) / 60_000) % MINUTES_IN_DAY;

/** 予定の最後の日。ちょうど0時に終わる予定は、前の日までの予定として扱う。 */
export function lastDateOf(event: Pick<CalendarEvent, 'startsAt' | 'endsAt'>): string {
  const start = dateKeyFromRfc3339(event.startsAt);
  const end = dateKeyFromRfc3339(event.endsAt);
  return end > start && minutesOfDay(event.endsAt) === 0 ? addDateKeyDays(end, -1) : end;
}

const occurrenceOf = (event: CalendarEvent, date: string): Occurrence => {
  const span = dayGap(dateKeyFromRfc3339(event.startsAt), dateKeyFromRfc3339(event.endsAt));
  return { ...event, occurrenceDate: date as IsoDate, startsAt: occurrenceStartsAt(event.startsAt, date), endsAt: occurrenceStartsAt(event.endsAt, addDateKeyDays(date, span)) };
};

/** dateKey に始まる回。繰り返しの回でなければ undefined。 */
export function occurrenceStartingOn(event: CalendarEvent, dateKey: string): Occurrence | undefined {
  const start = dateKeyFromRfc3339(event.startsAt);
  const hit = event.recurrence ? occurrenceDates(start, event.recurrence, dateKey, dateKey).length === 1 : start === dateKey;
  return hit ? occurrenceOf(event, dateKey) : undefined;
}

/** [from, to] に1日でもかかる回。範囲より前に始まって続いている回も含める。 */
export function expandEvent(event: CalendarEvent, from: string, to: string): Occurrence[] {
  const start = dateKeyFromRfc3339(event.startsAt);
  const earliest = addDateKeyDays(from, -dayGap(start, lastDateOf(event)));
  const dates = event.recurrence ? occurrenceDates(start, event.recurrence, earliest, to) : start >= earliest && start <= to ? [start] : [];
  return dates.map((date) => occurrenceOf(event, date));
}

export function occurrencesBetween(events: readonly CalendarEvent[], from: string, to: string): Occurrence[] {
  return events.flatMap((event) => expandEvent(event, from, to)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export const occursOn = (occurrence: Occurrence, date: string) => occurrence.occurrenceDate <= date && lastDateOf(occurrence) >= date;

/** 帯として描く予定（終日、または日をまたぐ予定）。 */
export const isSpanning = (occurrence: Occurrence) => Boolean(occurrence.allDay) || lastDateOf(occurrence) > occurrence.occurrenceDate;

export interface LanePlacement {
  occurrence: Occurrence;
  lane: number;
  colStart: number;
  colEnd: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}
export interface LaneLayout {
  placements: LanePlacement[];
  /** 列ごとの、段に入らなかった項目の数。 */
  hidden: number[];
}

/**
 * 週の行の段の割り当て。帯を先に長い順で段へ入れ、1日の項目はその列で空いている一番上の段へ入れる。
 * 列の項目が段に収まらないときは、その列の最後の段を「+n」に使い、そこにかかる項目は隠して数える。
 * clip を渡すと、その範囲の外の列には置かない（狭い幅の月の切れ目で使う）。
 */
export function layoutLanes(dates: readonly string[], occurrences: readonly Occurrence[], maxLanes: number, clip?: { from: string; to: string }): LaneLayout {
  const from = clip && clip.from > dates[0] ? clip.from : dates[0];
  const to = clip && clip.to < dates[dates.length - 1] ? clip.to : dates[dates.length - 1];
  const hidden = dates.map(() => 0);
  const inRange = occurrences.filter((item) => item.occurrenceDate <= to && lastDateOf(item) >= from);
  const segment = (item: Occurrence) => {
    const first = item.occurrenceDate < from ? from : item.occurrenceDate;
    const last = lastDateOf(item) > to ? to : lastDateOf(item);
    return { item, colStart: dates.indexOf(first), colEnd: dates.indexOf(last) };
  };
  const spans = inRange.filter(isSpanning).map(segment).sort((a, b) => a.colStart - b.colStart || (b.colEnd - b.colStart) - (a.colEnd - a.colStart) || a.item.startsAt.localeCompare(b.item.startsAt));
  const used = dates.map(() => new Set<number>());
  const packed = spans.map((span) => {
    let lane = 0;
    while (used.slice(span.colStart, span.colEnd + 1).some((column) => column.has(lane))) lane += 1;
    for (let column = span.colStart; column <= span.colEnd; column += 1) used[column].add(lane);
    return { ...span, lane };
  });
  const singles = inRange.filter((item) => !isSpanning(item)).map(segment).map((single) => {
    let lane = 0;
    while (used[single.colStart].has(lane)) lane += 1;
    used[single.colStart].add(lane);
    return { ...single, lane };
  });
  const capacity = used.map((lanes) => (lanes.size > maxLanes ? Math.max(0, maxLanes - 1) : maxLanes));
  const placements: LanePlacement[] = [];
  for (const { item, colStart, colEnd, lane } of [...packed, ...singles]) {
    const fits = capacity.slice(colStart, colEnd + 1).every((limit) => lane < limit);
    if (fits) placements.push({ occurrence: item, lane, colStart, colEnd, continuesBefore: item.occurrenceDate < dates[colStart], continuesAfter: lastDateOf(item) > dates[colEnd] });
    else for (let column = colStart; column <= colEnd; column += 1) hidden[column] += 1;
  }
  return { placements, hidden };
}

export interface TimelineBlock {
  occurrence: Occurrence;
  /** その日の始まりからの分。短い予定は MIN_BLOCK_MINUTES まで伸ばす。 */
  start: number;
  end: number;
  column: number;
  columns: number;
}

/** その日の時間軸に置く予定を、重なりごとに列へ分ける。maxColumns に入らない列の予定は hidden に数える。 */
export function layoutTimeline(occurrences: readonly Occurrence[], date: string, maxColumns: number): { blocks: TimelineBlock[]; hidden: number } {
  const timed = occurrences.filter((item) => !isSpanning(item) && occursOn(item, date)).map((occurrence) => {
    const start = Math.min(minutesOfDay(occurrence.startsAt), MINUTES_IN_DAY - MIN_BLOCK_MINUTES);
    const stop = minutesOfDay(occurrence.endsAt) || MINUTES_IN_DAY;
    return { occurrence, start, end: Math.min(MINUTES_IN_DAY, Math.max(stop, start + MIN_BLOCK_MINUTES)) };
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  const blocks: TimelineBlock[] = [];
  let hidden = 0;
  let cursor = 0;
  while (cursor < timed.length) {
    const cluster = [timed[cursor]];
    let clusterEnd = timed[cursor].end;
    for (cursor += 1; cursor < timed.length && timed[cursor].start < clusterEnd; cursor += 1) {
      cluster.push(timed[cursor]);
      clusterEnd = Math.max(clusterEnd, timed[cursor].end);
    }
    const columnEnds: number[] = [];
    const assigned = cluster.map((item) => {
      const free = columnEnds.findIndex((end) => end <= item.start);
      const column = free === -1 ? columnEnds.length : free;
      columnEnds[column] = item.end;
      return { ...item, column };
    });
    const columns = Math.min(columnEnds.length, maxColumns);
    for (const item of assigned) {
      if (item.column < columns) blocks.push({ ...item, columns });
      else hidden += 1;
    }
  }
  return { blocks, hidden };
}

/** 押した位置を30分の刻みの開始時刻（分）にする。 */
export function slotMinutes(offsetY: number, hourHeight: number): number {
  if (hourHeight <= 0) return 9 * 60;
  return Math.max(0, Math.min(MINUTES_IN_DAY - 30, Math.floor((offsetY / hourHeight) * 2) * 30));
}

export const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** 時間軸を開いたときの先頭の分。今日を含むなら今の1時間前、そうでなければ7時。 */
export const initialTimelineMinutes = (dates: readonly string[], todayKey: string, nowMinutes: number) => (dates.includes(todayKey) ? Math.max(0, nowMinutes - 60) : 7 * 60);

/** 月の週。ほかの月の日だけの週は出さない。 */
export function monthWeeks(monthKey: string): CalendarGridDate[][] {
  const grid = monthGrid(monthKey);
  return Array.from({ length: 6 }, (_, index) => grid.slice(index * 7, index * 7 + 7)).filter((week) => week.some((day) => day.inCurrentMonth));
}

export function lastDayOfMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** その日に関わるタスク。期間のあるタスクは期間の日すべてに出す。 */
export function todosOn(todos: readonly Todo[], date: string): Todo[] {
  return todos.filter((todo) => {
    if (!todo.dueAt) return false;
    const end = dateKeyFromRfc3339(todo.dueAt);
    return (todo.dueStartAt ? dateKeyFromRfc3339(todo.dueStartAt) : end) <= date && date <= end;
  });
}

export const expensesOn = (expenses: readonly Expense[], date: string) => expenses.filter((expense) => expense.incurredOn === date);
