import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { isCalendarDayKey, movedDateKey, shiftMonthKey, type CalendarGridDate } from '../../domain/calendarDate';
import { isSpanning, lastDayOfMonth, layoutLanes, monthWeeks, occurrencesBetween, occursOn, type LanePlacement, type Occurrence } from '../../domain/calendarLayout';
import { formatTime } from '../../design-system/components';
import { SeasonMark } from '../../design-system/SeasonMark';
import { dayLabel, dayTone, holidayMap, labelStyle, monthHeading } from './calendarLabels';
import { useReachedEnd } from './calendarHooks';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const WIDE_LANES = 4;
const NARROW_LANES = 3;
const LAST_FLOW_MONTH = '2100-12';

interface DayProps {
  todayKey: string;
  selected: string | null;
  onSelect: (date: string) => void;
}
interface MonthProps extends DayProps {
  monthKey: string;
  occurrences: readonly Occurrence[];
  holidays: ReadonlyMap<string, string>;
  expenseDays: ReadonlySet<string>;
  maxLanes: number;
  /** 狭い幅の連続表示。ほかの月の日は出さず、帯も月の中で切る。 */
  flow?: boolean;
}

function Weekdays() {
  return <div className="month-weekdays" aria-hidden="true">{WEEKDAYS.map((day, index) => <div className="weekday" data-tone={index === 0 ? 'holiday' : index === 6 ? 'saturday' : undefined} key={day}>{day}</div>)}</div>;
}

/** 段の上の項目。読み上げは日のボタンの説明と日の一覧で伝えるので、これ自体は飾りで、押すと下の日が選ばれる。 */
function LaneItem({ placement }: { placement: LanePlacement }) {
  const { snapshot } = useApp();
  const { occurrence, lane, colStart, colEnd, continuesBefore, continuesAfter } = placement;
  const spanning = isSpanning(occurrence);
  return <span className={spanning ? 'calendar-ribbon' : 'calendar-item'} aria-hidden="true" data-start={colStart} data-end={colEnd} data-lane={lane} data-before={continuesBefore || undefined} data-after={continuesAfter || undefined} style={labelStyle(snapshot.colorLabels, occurrence.colorLabelId)}>
    {!spanning && <time>{formatTime(occurrence.startsAt)}</time>}<span className="calendar-item-title">{occurrence.title}</span>
  </span>;
}

/** 矢印などのキーで日を動かす。動かした先の日へ焦点も移す（別の月へ移ると表が作り直される）。 */
function useMonthKeys(onSelect: (date: string) => void) {
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const target = document.querySelector<HTMLElement>(`button.day[data-date="${pendingFocus.current}"]`);
    if (!target) return;
    target.focus();
    pendingFocus.current = null;
  });
  return (event: KeyboardEvent<HTMLElement>) => {
    const date = (event.target as HTMLElement).closest<HTMLElement>('button.day')?.dataset.date;
    if (!date || !isCalendarDayKey(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const next = movedDateKey(date, event.key);
    pendingFocus.current = next;
    onSelect(next);
  };
}

/** キーで移る表なので、Tab で止まる日は1か月に1つだけにする。 */
const tabStopOf = (monthKey: string, selected: string | null, todayKey: string) => (selected?.startsWith(monthKey) ? selected : todayKey.startsWith(monthKey) ? todayKey : `${monthKey}-01`);
const MONTH_GROUP_LABEL = '月の日付。矢印キーで日を移せます';

function DayCell({ day, column, todayKey, selected, onSelect, holiday, count, yen, tabStop }: DayProps & { day: CalendarGridDate; column: number; holiday?: string; count: number; yen: boolean; tabStop: string }) {
  const description = [dayLabel(day.date), holiday, `予定${count}件`, yen ? '支出あり' : undefined].filter(Boolean).join('、');
  // 祝日のマスは「22 秋分の日」と見えている。音声で操作する人が見えている言葉で押せるよう、名前は見えている文字から始め、残りは読み上げだけに足す（WCAG 2.5.3）。
  const rest = [dayLabel(day.date), `予定${count}件`, yen ? '支出あり' : undefined].filter(Boolean).join('、');
  return <button data-control-id={`calendar.day.${day.date}`} type="button" className="day" data-col={column} data-date={day.date} data-tone={dayTone(day.date, holiday)} data-outside={day.inCurrentMonth ? undefined : true} aria-label={holiday ? undefined : description} aria-pressed={selected === day.date} aria-current={day.date === todayKey ? 'date' : undefined} tabIndex={day.date === tabStop ? 0 : -1} onClick={() => onSelect(day.date)}>
    <span className="day-head"><span className="date-num">{day.day}</span>{holiday && <span className="day-holiday" title={holiday}>{holiday}</span>}{yen && <span className="day-yen" aria-hidden={holiday ? true : undefined}>¥</span>}</span>
    {holiday && <span className="sr-only">、{rest}</span>}
  </button>;
}

function MonthWeeks({ monthKey, occurrences, holidays, expenseDays, maxLanes, flow, ...day }: MonthProps) {
  const clip = flow ? { from: `${monthKey}-01`, to: lastDayOfMonth(monthKey) } : undefined;
  const tabStop = tabStopOf(monthKey, day.selected, day.todayKey);
  return <>{monthWeeks(monthKey).map((week) => {
    const dates = week.map((item) => item.date);
    const items = occurrences.filter((item) => dates.some((date) => occursOn(item, date)));
    const { placements, hidden } = layoutLanes(dates, items, maxLanes, clip);
    return <div className="month-week" data-lanes={maxLanes} key={dates[0]}>
      {week.map((item, column) => (flow && !item.inCurrentMonth
        ? <div className="day blank" data-col={column} key={item.date}/>
        : <DayCell key={item.date} {...day} day={item} tabStop={tabStop} column={column} holiday={holidays.get(item.date)} count={occurrences.filter((entry) => occursOn(entry, item.date)).length} yen={expenseDays.has(item.date)}/>))}
      {placements.map((placement) => <LaneItem key={`${placement.occurrence.id}-${placement.occurrence.occurrenceDate}`} placement={placement}/>)}
      {hidden.map((count, column) => count > 0 && <span className="calendar-more" aria-hidden="true" data-start={column} data-end={column} data-lane={maxLanes - 1} key={dates[column]}>+{count}</span>)}
    </div>;
  })}</>;
}

/** 広い幅の1か月の表示。 */
export function MonthGrid({ monthKey, expenseDays, ...day }: DayProps & { monthKey: string; expenseDays: ReadonlySet<string> }) {
  const { events } = useMemberScope();
  const onKeyDown = useMonthKeys(day.onSelect);
  const weeks = monthWeeks(monthKey);
  const from = weeks[0][0].date;
  const to = weeks[weeks.length - 1][6].date;
  const occurrences = useMemo(() => occurrencesBetween(events, from, to), [events, from, to]);
  const holidays = useMemo(() => holidayMap(from, to), [from, to]);
  return <div className="month" role="group" aria-label={MONTH_GROUP_LABEL} onKeyDown={onKeyDown}><Weekdays/><MonthWeeks {...day} monthKey={monthKey} occurrences={occurrences} holidays={holidays} expenseDays={expenseDays} maxLanes={WIDE_LANES}/></div>;
}

/** 狭い幅の表示。月を縦に続け、下へ進むと次の月を足す。上の見出しは今見ている月を示す。 */
export function MonthFlow({ monthKey, expenseDays, jump, ...day }: DayProps & { monthKey: string; expenseDays: ReadonlySet<string>; jump: number }) {
  const { events } = useMemberScope();
  const onKeyDown = useMonthKeys(day.onSelect);
  const [span, setSpan] = useState({ from: monthKey, to: shiftMonthKey(monthKey, 2) });
  // 前月・次月や年月の選択で範囲の外へ移ったら、その月まで広げる。
  if (monthKey < span.from || monthKey > span.to) setSpan({ from: monthKey < span.from ? monthKey : span.from, to: monthKey > span.to ? monthKey : span.to });
  const months = useMemo(() => {
    const list = [span.from];
    while (list[list.length - 1] < span.to) list.push(shiftMonthKey(list[list.length - 1], 1));
    return list;
  }, [span]);
  const from = `${span.from}-01`;
  const to = lastDayOfMonth(span.to);
  const occurrences = useMemo(() => occurrencesBetween(events, from, to), [events, from, to]);
  const holidays = useMemo(() => holidayMap(from, to), [from, to]);
  const canGrow = span.to < LAST_FLOW_MONTH;
  const marker = useReachedEnd(canGrow, span.to, () => setSpan((current) => ({ ...current, to: shiftMonthKey(current.to, 1) })));
  const handledJump = useRef(0);
  // 前月・次月・今月・年月の選択のときだけ、その月へ移る（日を押したときは読んでいる位置を動かさない）。
  useLayoutEffect(() => {
    if (handledJump.current === jump) return;
    handledJump.current = jump;
    document.getElementById(`calendar-month-${monthKey}`)?.scrollIntoView({ block: 'start' });
  }, [jump, monthKey]);
  return <div className="month-flow">
    {months.map((month) => <section className="month-block" id={`calendar-month-${month}`} aria-labelledby={`calendar-month-title-${month}`} key={month}>
      <div className="month-sticky"><h2 id={`calendar-month-title-${month}`}><SeasonMark date={month}/>{monthHeading(month)}</h2><Weekdays/></div>
      <div className="month" role="group" aria-label={MONTH_GROUP_LABEL} onKeyDown={onKeyDown}><MonthWeeks {...day} flow monthKey={month} occurrences={occurrences} holidays={holidays} expenseDays={expenseDays} maxLanes={NARROW_LANES}/></div>
    </section>)}
    <div ref={marker} className="calendar-sentinel"/>
  </div>;
}
