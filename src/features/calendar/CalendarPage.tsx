import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { detailId, navigate } from '../../app/router';
import { DetailNotFound, PageHeader } from '../../design-system/components';
import { CalendarIcon, CloseIcon } from '../../design-system/icons';
import { addDateKeyDays, dateKeyFromRfc3339, isCalendarView, monthKeyFromRfc3339, readCalendarLocation, shiftMonthKey, weekDates, writeCalendarLocation, type CalendarLocation, type CalendarView } from '../../domain/calendarDate';
import { occurrenceStartingOn, type Occurrence } from '../../domain/calendarLayout';
import { occurrenceDates } from '../../domain/recurrence';
import type { CalendarEvent } from '../../domain/types';
import { EventReader } from '../assistant/EventReader';
import { MemberScopeSelect } from '../shared/MemberScopeSelect';
import { AgendaView } from './AgendaView';
import { CalendarToolbar } from './CalendarToolbar';
import { DayEntries } from './DayPanel';
import { EventDrawer, type DeletedEvent } from './EventDrawer';
import { MonthFlow, MonthGrid } from './MonthView';
import { ShiftReader } from './ShiftReader';
import { TimelineView } from './TimelineView';
import { useIsNarrow } from './calendarHooks';
import { dayLabel, monthHeading, weekHeading, yearDayHeading } from './calendarLabels';

const VIEW_KEY = 'family-hub-calendar-view';
const rememberedView = (): CalendarView => {
  const stored = localStorage.getItem(VIEW_KEY);
  return isCalendarView(stored) ? stored : 'month';
};

/** 開く回。?on= の回があればその回、なければ今日以降で最初の回、それもなければ最後の回。 */
function occurrenceToOpen(event: CalendarEvent, requested: string | null, todayKey: string): Occurrence {
  const start = dateKeyFromRfc3339(event.startsAt);
  const asked = requested ? occurrenceStartingOn(event, requested) : undefined;
  if (asked) return asked;
  const dates = event.recurrence ? [...occurrenceDates(start, event.recurrence, todayKey, addDateKeyDays(todayKey, 400)).slice(0, 1), ...occurrenceDates(start, event.recurrence, start, todayKey).slice(-1)] : [];
  return occurrenceStartingOn(event, dates[0] ?? start) ?? { ...event, occurrenceDate: start as Occurrence['occurrenceDate'] };
}

export function CalendarPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce, can, requestQuickCreate } = useApp();
  const todayKey = dateKeyFromRfc3339(snapshot.context.asOf);
  const currentMonthKey = monthKeyFromRfc3339(snapshot.context.asOf);
  const narrow = useIsNarrow();
  const { expenses: scopedExpenses } = useMemberScope();
  const [location, setLocation] = useState<CalendarLocation>(() => readCalendarLocation(window.location.href, todayKey, rememberedView()));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleted, setDeleted] = useState<DeletedEvent | null>(null);
  const [jump, setJump] = useState(0);
  const { view, monthKey, selected } = location;
  const anchor = selected ?? `${monthKey}-01`;
  const week = useMemo(() => weekDates(anchor), [anchor]);
  const canCreate = can('event.create');

  useEffect(() => {
    const sync = () => { if (window.location.pathname === '/calendar') setLocation(readCalendarLocation(window.location.href, todayKey, rememberedView())); };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [todayKey]);
  useEffect(() => { localStorage.setItem(VIEW_KEY, view); }, [view]);

  /** 画面の状態を URL へ書き、URL から読み直す。 */
  const go = (next: Partial<CalendarLocation>, replace = false) => {
    const merged = { ...location, ...next };
    localStorage.setItem(VIEW_KEY, merged.view);
    navigate(writeCalendarLocation(window.location.href, merged, todayKey), replace, true);
  };
  const close = useCallback(() => navigate(writeCalendarLocation(window.location.href, location, todayKey), false, true), [location, todayKey]);
  const open = (occurrence: Occurrence) => navigate(writeCalendarLocation(window.location.href, location, todayKey, `/calendar/${occurrence.id}`, occurrence.occurrenceDate), false, true);
  const selectDay = (date: string) => {
    go({ selected: date, monthKey: date.slice(0, 7) }, true);
    if (narrow && view === 'month') {
      setSheetOpen(true);
      // 下の日は開いた一覧に隠れるので、見える位置まで送る。
      requestAnimationFrame(() => document.querySelector(`.day[data-date="${date}"]`)?.scrollIntoView({ block: 'nearest' }));
    }
  };
  const moveTo = (date: string) => go({ selected: date, monthKey: date.slice(0, 7) });
  const step = (direction: -1 | 1) => {
    setJump((count) => count + 1);
    if (view === 'week') moveTo(addDateKeyDays(anchor, direction * 7));
    else if (view === 'day') moveTo(addDateKeyDays(anchor, direction));
    else go({ monthKey: shiftMonthKey(monthKey, direction), selected: null });
  };
  const jumpTo = (next: string, date: string | null) => { setJump((count) => count + 1); go({ monthKey: next, selected: date }); };
  // 日と週は1日を基準に見るので、日を選んでいなければ基準の日を選んだ状態にする。
  const changeView = (next: CalendarView) => { go({ view: next, selected: next === 'day' || next === 'week' ? anchor : selected }); setSheetOpen(false); };
  const createAt = (date: string, time?: string) => requestQuickCreate('event', { date, time });

  const activeId = detailId(path, '/calendar');
  const activeEvent = snapshot.events.find((event) => event.id === activeId);
  const active = useMemo(() => (activeEvent ? occurrenceToOpen(activeEvent, new URLSearchParams(window.location.search).get('on'), todayKey) : undefined), [activeEvent, todayKey]);
  const expenseDays = useMemo(() => new Set(can('expense.read') ? scopedExpenses.map((expense) => expense.incurredOn) : []), [scopedExpenses, can]);

  const restoreDeleted = async () => {
    if (!deleted) return;
    const result = await gateway.events.restoreEvent(deleted.event.id, deleted.occurrenceDate);
    if (!result.ok) return announce(result.error.message);
    setDeleted(null);
    await refresh();
    announce(`「${result.value.title}」を元に戻しました`);
  };

  const heading = view === 'week' ? weekHeading(week) : view === 'day' ? yearDayHeading(anchor) : monthHeading(monthKey);
  const dayProps = { todayKey, selected, onSelect: selectDay };
  const flow = narrow && view === 'month';
  const dayEntries = (headingId: string) => <DayEntries selected={selected} headingId={headingId} onOpen={open} onCreate={canCreate ? (date) => createAt(date) : undefined}/>;
  const addButton = canCreate ? <button data-control-id="calendar.event.create" className="button primary" type="button" onClick={() => createAt(selected ?? todayKey)}>予定を追加</button> : undefined;

  return <div className="page">
    <PageHeader eyebrow="予定" title="家族の予定" description="月・週・日・一覧で、家族の予定と参加者を確認できます。" action={<div className="page-head-actions"><MemberScopeSelect/>{addButton}</div>}/>
    {canCreate && <div className="calendar-readers" role="group" aria-label="読み取って予定を追加"><ShiftReader/><EventReader/></div>}
    {activeId && !activeEvent && <DetailNotFound what="予定" feature="calendar" backHref="/calendar"/>}
    {deleted && <div className="callout info" role="status"><CalendarIcon/><div><strong>「{deleted.event.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id={`calendar.event.restore.${deleted.event.id}`} className="button" type="button" onClick={() => void restoreDeleted()}>元に戻す</button></div>}
    <div className="calendar-layout" data-view={view}>
      <section aria-label={`${heading}のカレンダー`} className="calendar-main">
        <CalendarToolbar view={view} heading={heading} monthKey={monthKey} onView={changeView} onStep={step} onToday={() => jumpTo(currentMonthKey, todayKey)} onMonth={(next) => jumpTo(next, next === currentMonthKey ? todayKey : null)}/>
        {view === 'month' && (flow ? <MonthFlow {...dayProps} monthKey={monthKey} expenseDays={expenseDays} jump={jump}/> : <MonthGrid {...dayProps} monthKey={monthKey} expenseDays={expenseDays}/>)}
        {view === 'week' && <TimelineView dates={week} label={`${dayLabel(week[0])}から${dayLabel(week[6])}の予定`} narrow={narrow} todayKey={todayKey} selected={selected} canCreate={canCreate} onOpen={open} onSelect={selectDay} onCreate={createAt}/>}
        {view === 'day' && <TimelineView key={anchor} dates={[anchor]} label={`${dayLabel(anchor)}の予定`} narrow={narrow} todayKey={todayKey} selected={selected} canCreate={canCreate} onOpen={open} onSelect={selectDay} onCreate={createAt}/>}
        {view === 'list' && <AgendaView key={monthKey} monthKey={monthKey} todayKey={todayKey} selected={selected} onOpen={open}/>}
      </section>
      {!flow && !(narrow && view === 'list') && <aside className="card flat calendar-day-panel" aria-labelledby="selected-day">{dayEntries('selected-day')}</aside>}
    </div>
    {flow && sheetOpen && <section className="calendar-day-sheet" aria-labelledby="sheet-day">
      <button data-control-id="calendar.day.sheet-close" className="icon-button calendar-sheet-close" type="button" aria-label="日の一覧を閉じる" onClick={() => setSheetOpen(false)}><CloseIcon/></button>
      {dayEntries('sheet-day')}
    </section>}
    {active && activeEvent && <EventDrawer key={`${active.id}-${active.occurrenceDate}`} active={active} series={activeEvent} onClose={close} onDeleted={setDeleted}/>}
  </div>;
}
