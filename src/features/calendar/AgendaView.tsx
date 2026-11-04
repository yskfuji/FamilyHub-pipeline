import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { EmptyState } from '../../design-system/components';
import { EmptyEvents } from '../../design-system/illustrations/EmptyEvents';
import { addDateKeyDays } from '../../domain/calendarDate';
import { lastDayOfMonth, occurrencesBetween, occursOn, type Occurrence } from '../../domain/calendarLayout';
import { dayLabel, dayTone, holidayMap, labelStyle, monthHeading, timeOnDay } from './calendarLabels';
import { useReachedEnd } from './calendarHooks';

const STEP_DAYS = 30;
const MAX_DAYS = 366;

interface Props {
  monthKey: string;
  todayKey: string;
  selected: string | null;
  onOpen: (occurrence: Occurrence) => void;
}

/** 一覧。月の初めから日ごとに読み、下へ進むと後の日を足す。日付の見出しは上に留まる。 */
export function AgendaView({ monthKey, todayKey, selected, onOpen }: Props) {
  const { snapshot, can, requestQuickCreate } = useApp();
  const { events } = useMemberScope();
  const from = `${monthKey}-01`;
  const limit = addDateKeyDays(from, MAX_DAYS);
  const [to, setTo] = useState(() => lastDayOfMonth(monthKey));
  const occurrences = useMemo(() => occurrencesBetween(events, from, to), [events, from, to]);
  const holidays = useMemo(() => holidayMap(from, to), [from, to]);
  const days = useMemo(() => {
    const anchors = [todayKey, selected].filter((date): date is string => Boolean(date) && (date as string) >= from && (date as string) <= to);
    const dates = new Set(anchors);
    for (const item of occurrences) for (let date = item.occurrenceDate < from ? from : item.occurrenceDate; occursOn(item, date) && date <= to; date = addDateKeyDays(date, 1)) dates.add(date);
    return [...dates].sort();
  }, [occurrences, todayKey, selected, from, to]);
  const more = () => setTo((current) => { const next = addDateKeyDays(current, STEP_DAYS); return next > limit ? limit : next; });
  const canGrow = to < limit;
  const marker = useReachedEnd(canGrow, to, more);
  // 開いたとき、選んだ日へ合わせる。
  useEffect(() => {
    if (selected && selected !== from) document.getElementById(`calendar-agenda-${selected}`)?.closest('section')?.scrollIntoView({ block: 'start' });
  }, [selected, from]);
  return <section className="calendar-agenda" aria-label={`${monthHeading(monthKey)}からの予定の一覧`}>
    {occurrences.length === 0 && <EmptyState title={`${monthHeading(monthKey)}からの予定はありません`} illustration={<EmptyEvents/>} action={can('event.create') ? <button data-control-id="calendar.agenda.create" className="button primary" type="button" onClick={() => requestQuickCreate('event')}>この月に予定を追加</button> : undefined}>前月・次月の予定も確認できます。</EmptyState>}
    {days.map((day) => {
      const holiday = holidays.get(day);
      const entries = occurrences.filter((item) => occursOn(item, day));
      return <section className="agenda-day" data-date={day} aria-labelledby={`calendar-agenda-${day}`} key={day}>
        <h3 className="agenda-heading" id={`calendar-agenda-${day}`} data-tone={dayTone(day, holiday)}>{dayLabel(day)}{day === todayKey && <span className="badge">今日</span>}{holiday && <span className="day-holiday">{holiday}</span>}</h3>
        {entries.length === 0 ? <p className="small muted agenda-empty">予定はありません</p> : <ul className="list">
          {entries.map((event) => <li className="list-row agenda-row" style={labelStyle(snapshot.colorLabels, event.colorLabelId)} key={`${event.id}-${event.occurrenceDate}`}>
            <time className="time">{timeOnDay(event, day)}</time>
            <div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所は未設定です'}</span></div>
            <button data-control-id={`calendar.event.open.${event.id}.${event.occurrenceDate}.${day}`} className="button" type="button" aria-label={`${event.title}を開く`} onClick={() => onOpen(event)}>開く</button>
          </li>)}
        </ul>}
      </section>;
    })}
    <div ref={marker} className="calendar-sentinel"/>
    {canGrow ? <button data-control-id="calendar.agenda.more" className="button" type="button" onClick={more}>さらに表示</button> : <p className="small muted">{dayLabel(limit)}までの予定を表示しました。</p>}
  </section>;
}
