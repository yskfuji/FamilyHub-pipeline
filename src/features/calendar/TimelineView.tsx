import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { formatTime } from '../../design-system/components';
import { MINUTES_IN_DAY, clockOf, initialTimelineMinutes, isSpanning, layoutLanes, layoutTimeline, occurrencesBetween, slotMinutes, type Occurrence, type TimelineBlock } from '../../domain/calendarLayout';
import { dayLabel, dayTone, holidayMap, labelStyle } from './calendarLabels';
import { useNowMinutes } from './calendarHooks';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const KEYBOARD_SLOT = 9 * 60;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

interface Props {
  dates: readonly string[];
  label: string;
  narrow: boolean;
  todayKey: string;
  selected: string | null;
  canCreate: boolean;
  onOpen: (occurrence: Occurrence) => void;
  onSelect: (date: string) => void;
  onCreate: (date: string, time: string) => void;
}

const positionOf = (start: number, end: number) => ({ '--start': start / 60, '--length': (end - start) / 60 });

function Block({ block, onOpen }: { block: TimelineBlock; onOpen: (occurrence: Occurrence) => void }) {
  const { snapshot } = useApp();
  const { occurrence, start, end, column, columns } = block;
  const range = `${formatTime(occurrence.startsAt)}〜${formatTime(occurrence.endsAt)}`;
  const style = { ...positionOf(start, end), '--column': column, '--columns': columns, ...labelStyle(snapshot.colorLabels, occurrence.colorLabelId) } as CSSProperties;
  return <button data-control-id={`calendar.event.open.${occurrence.id}.${occurrence.occurrenceDate}`} className="timeline-block" type="button" style={style} aria-label={`${range} ${occurrence.title}を開く`} onClick={() => onOpen(occurrence)}>
    <time>{formatTime(occurrence.startsAt)}</time><strong>{occurrence.title}</strong>
  </button>;
}

function AllDayRow({ dates, occurrences, narrow, onOpen }: Pick<Props, 'dates' | 'narrow' | 'onOpen'> & { occurrences: readonly Occurrence[] }) {
  const { snapshot } = useApp();
  const spanning = occurrences.filter(isSpanning);
  const maxLanes = dates.length === 1 ? 4 : narrow ? 2 : 3;
  const { placements, hidden } = layoutLanes(dates, spanning, maxLanes);
  return <div className="timeline-allday">
    <span className="timeline-gutter-label">終日</span>
    <div className="timeline-allday-grid" data-days={dates.length}>
      {placements.map(({ occurrence, lane, colStart, colEnd, continuesBefore, continuesAfter }) => <button data-control-id={`calendar.event.open.${occurrence.id}.${occurrence.occurrenceDate}`} className="calendar-ribbon timeline-ribbon" type="button" data-start={colStart} data-end={colEnd} data-lane={lane} data-before={continuesBefore || undefined} data-after={continuesAfter || undefined} style={labelStyle(snapshot.colorLabels, occurrence.colorLabelId)} aria-label={`${occurrence.title}を開く`} key={`${occurrence.id}-${occurrence.occurrenceDate}`} onClick={() => onOpen(occurrence)}>
        <span className="calendar-item-title">{occurrence.title}</span>
      </button>)}
      {hidden.map((count, column) => count > 0 && <span className="calendar-more" data-start={column} data-end={column} data-lane={maxLanes - 1} key={dates[column]}>他{count}件</span>)}
    </div>
  </div>;
}

/** 週と日の時間軸。何もない所を押すと、その30分の枠で予定の追加を開く。 */
export function TimelineView({ dates, label, narrow, todayKey, selected, canCreate, onOpen, onSelect, onCreate }: Props) {
  const { snapshot } = useApp();
  const { events } = useMemberScope();
  const from = dates[0];
  const to = dates[dates.length - 1];
  const occurrences = useMemo(() => occurrencesBetween(events, from, to), [events, from, to]);
  const holidays = useMemo(() => holidayMap(from, to), [from, to]);
  const nowMinutes = useNowMinutes(snapshot.context.asOf);
  const week = dates.length > 1;
  // 押せる幅を保てる列の数。入らない予定は「他n件」と日の一覧で示す。
  const maxColumns = week ? (narrow ? 1 : 2) : (narrow ? 4 : 6);
  const layouts = useMemo(() => new Map(dates.map((date) => [date, layoutTimeline(occurrences, date, maxColumns)])), [dates, occurrences, maxColumns]);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [openedAt] = useState(nowMinutes);
  const firstMinutes = initialTimelineMinutes(dates, todayKey, openedAt);
  useLayoutEffect(() => {
    if (scroller.current && body.current) scroller.current.scrollTop = (firstMinutes / MINUTES_IN_DAY) * body.current.offsetHeight;
  }, [from, to, firstMinutes]);
  return <section className="calendar-timeline card flat" aria-label={label} data-days={dates.length}>
    <div className="timeline-scroll" ref={scroller}>
      <div className="timeline-inner">
        <div className="timeline-top">
          <div className="timeline-dates">
            <span className="timeline-gutter-label"/>
            <div className="timeline-date-row" data-days={dates.length}>
              {dates.map((date) => {
                const holiday = holidays.get(date);
                const hidden = layouts.get(date)?.hidden ?? 0;
                return <button data-control-id={`calendar.day.${date}`} className="timeline-date" type="button" data-tone={dayTone(date, holiday)} aria-pressed={selected === date} aria-current={date === todayKey ? 'date' : undefined} key={date} onClick={() => onSelect(date)}>
                  <span className="timeline-date-label">{Number(date.slice(8, 10))}<small>{WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]}</small></span>
                  {holiday && <span className="day-holiday" title={holiday}>{holiday}</span>}
                  {hidden > 0 && <span className="timeline-hidden">他{hidden}件</span>}
                </button>;
              })}
            </div>
          </div>
          <AllDayRow dates={dates} occurrences={occurrences} narrow={narrow} onOpen={onOpen}/>
        </div>
        <div className="timeline-body" ref={body}>
          <div className="timeline-hours" aria-hidden="true">{HOURS.map((hour) => <span key={hour}>{hour === 0 ? '' : `${hour}:00`}</span>)}</div>
          <div className="timeline-columns" data-days={dates.length}>
            {dates.map((date) => <div className="timeline-day" data-date={date} key={date}>
              {canCreate && <button data-control-id={`calendar.timeline.add.${date}`} className="timeline-add" type="button" aria-label={`${dayLabel(date)}に予定を追加`} onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                // キーボードで押したときは位置がないので、朝の枠で開く。
                onCreate(date, clockOf(event.detail === 0 ? KEYBOARD_SLOT : slotMinutes(event.clientY - box.top, box.height / 24)));
              }}/>}
              {layouts.get(date)?.blocks.map((block) => <Block block={block} onOpen={onOpen} key={`${block.occurrence.id}-${block.occurrence.occurrenceDate}`}/>)}
              {date === todayKey && <div className="timeline-now" style={positionOf(nowMinutes, nowMinutes) as CSSProperties} aria-hidden="true"/>}
            </div>)}
          </div>
        </div>
      </div>
    </div>
  </section>;
}
