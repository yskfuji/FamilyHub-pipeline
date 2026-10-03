import { useEffect, useMemo, useState } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { detailId, navigate, useCloseTo } from '../../app/router';
import { DetailNotFound, Dialog, Drawer, EmptyState, PageHeader, StatusBadge, formatDate, formatTime } from '../../design-system/components';
import { CalendarIcon, LinkIcon, PeopleIcon, RainIcon } from '../../design-system/icons';
import type { CalendarEvent, IsoDate, RecurrenceScope } from '../../domain/types';
import { describeRule, occurrenceDates, occurrenceStartsAt } from '../../domain/recurrence';
import { addDateKeyDays, calendarMonthFromUrl, dateKeyFromRfc3339, monthGrid, monthKeyFromRfc3339, normalizeSelectedDate, shiftMonthKey, urlWithCalendarMonth, weekDates } from '../../domain/calendarDate';
import { ja, recurrenceLabel } from '../../content/ja';

const localValue = (value: string) => value.slice(0, 16);
const rfcValue = (value: string) => `${value}:00+09:00`;
/** 繰り返しを展開した1回分。startsAt / endsAt はその回の日時。 */
type Occurrence = CalendarEvent & { occurrenceDate: IsoDate };
const spanDays = (event: CalendarEvent) => Math.round((Date.parse(`${dateKeyFromRfc3339(event.endsAt)}T00:00:00Z`) - Date.parse(`${dateKeyFromRfc3339(event.startsAt)}T00:00:00Z`)) / 86_400_000);
const occurrenceOf = (event: CalendarEvent, date: string): Occurrence => ({ ...event, occurrenceDate: date as IsoDate, startsAt: occurrenceStartsAt(event.startsAt, date), endsAt: occurrenceStartsAt(event.endsAt, addDateKeyDays(date, spanDays(event))) });
const expand = (event: CalendarEvent, from: string, to: string): Occurrence[] => {
  const start = dateKeyFromRfc3339(event.startsAt);
  const dates = event.recurrence ? occurrenceDates(start, event.recurrence, from, to) : start >= from && start <= to ? [start] : [];
  return dates.map((date) => occurrenceOf(event, date));
};
const timezoneLabel = (timezone: string) => (timezone === 'Asia/Tokyo' ? '日本時間' : timezone);
const monthHeading = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}年${month}月`;
};

export function CalendarPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce, can, requestQuickCreate, executeQueueable } = useApp();
  const currentMonthKey = monthKeyFromRfc3339(snapshot.context.asOf);
  const todayKey = dateKeyFromRfc3339(snapshot.context.asOf);
  const [activeMonthKey, setActiveMonthKey] = useState(() => calendarMonthFromUrl(window.location.href, currentMonthKey));
  const [selected, setSelected] = useState<string | null>(() => normalizeSelectedDate(todayKey, calendarMonthFromUrl(window.location.href, currentMonthKey)));
  const [view, setView] = useState<'month'|'week'|'list'>('month');
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(Number(activeMonthKey.slice(0, 4)));
  const [draftMonth, setDraftMonth] = useState(Number(activeMonthKey.slice(5, 7)));
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scope, setScope] = useState<RecurrenceScope>('this');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleted, setDeleted] = useState<CalendarEvent | null>(null);
  const activeId = detailId(path, '/calendar');
  const activeEvent = snapshot.events.find((event) => event.id === activeId);
  // どの回を開いたかは ?on= で示す。指定がなければ今日以降で最初の回（なければ最初の回）。
  const requestedOn = new URLSearchParams(window.location.search).get('on');
  const active: Occurrence | undefined = activeEvent ? (() => {
    const start = dateKeyFromRfc3339(activeEvent.startsAt);
    const valid = requestedOn && expand(activeEvent, requestedOn, requestedOn).length === 1 ? requestedOn : null;
    const upcoming = activeEvent.recurrence ? occurrenceDates(start, activeEvent.recurrence, todayKey, addDateKeyDays(todayKey, 400))[0] : null;
    return occurrenceOf(activeEvent, valid ?? upcoming ?? start);
  })() : undefined;
  const close = useCloseTo(`/calendar${activeMonthKey === currentMonthKey ? '' : `?month=${activeMonthKey}`}`);
  const gridDates = useMemo(() => monthGrid(activeMonthKey), [activeMonthKey]);
  const week = useMemo(() => weekDates(selected ?? `${activeMonthKey}-01`), [activeMonthKey, selected]);
  const rangeFrom = week[0] < gridDates[0].date ? week[0] : gridDates[0].date;
  const rangeTo = week[6] > gridDates[41].date ? week[6] : gridDates[41].date;
  const occurrences = useMemo(() => snapshot.events.flatMap((event) => expand(event, rangeFrom, rangeTo)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [snapshot.events, rangeFrom, rangeTo]);
  const eventsFor = (date: string) => occurrences.filter((event) => event.occurrenceDate === date);
  const monthEvents = useMemo(() => occurrences.filter((event) => event.occurrenceDate.startsWith(`${activeMonthKey}-`)), [activeMonthKey, occurrences]);
  const openOccurrence = (event: Occurrence) => navigate(`/calendar/${event.id}?month=${activeMonthKey}&on=${event.occurrenceDate}`);
  const resources = activeEvent && can('resource.read') ? snapshot.resources.filter((resource) => activeEvent.resourceIds?.includes(resource.id)) : [];
  const nextHoliday = snapshot.context.holidays
    .filter((holiday) => holiday.date.startsWith(`${activeMonthKey}-`) && holiday.date >= (selected ?? `${activeMonthKey}-01`))
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  useEffect(() => {
    const syncFromUrl = () => {
      const nextMonth = calendarMonthFromUrl(window.location.href, currentMonthKey);
      setActiveMonthKey(nextMonth);
      setSelected((current) => normalizeSelectedDate(current, nextMonth));
    };
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [currentMonthKey]);

  const showMonth = (nextMonthKey: string, selectToday = false) => {
    setActiveMonthKey(nextMonthKey);
    setSelected(selectToday ? todayKey : null);
    navigate(urlWithCalendarMonth(window.location.href, nextMonthKey, currentMonthKey));
  };
  const openMonthPicker = () => {
    setDraftYear(Number(activeMonthKey.slice(0, 4)));
    setDraftMonth(Number(activeMonthKey.slice(5, 7)));
    setMonthPickerOpen(true);
  };

  const updateEvent = async (event: Occurrence, form: HTMLFormElement) => {
    if (submitting) return; setFormError(''); setSubmitting(true);
    const data = new FormData(form);
    const participants = data.getAll('participants').map(String);
    if (!participants.length) { setFormError('参加者を1人以上選んでください。'); setSubmitting(false); return; }
    let startsAt = rfcValue(String(data.get('startsAt'))); let endsAt = rfcValue(String(data.get('endsAt')));
    const recurring = Boolean(event.recurrence);
    if (recurring && scope === 'series') {
      // シリーズ全体の変更では、開いた回の日付ではなくシリーズの開始日に時刻を当てはめる。
      const seriesStart = dateKeyFromRfc3339(activeEvent!.startsAt);
      const shift = Math.round((Date.parse(`${dateKeyFromRfc3339(endsAt)}T00:00:00Z`) - Date.parse(`${dateKeyFromRfc3339(startsAt)}T00:00:00Z`)) / 86_400_000);
      startsAt = occurrenceStartsAt(startsAt, seriesStart); endsAt = occurrenceStartsAt(endsAt, addDateKeyDays(seriesStart, shift));
    }
    const input = {
      title: String(data.get('title') ?? '').trim(), startsAt, endsAt,
      location: String(data.get('location') ?? '').trim() || undefined, note: String(data.get('note') ?? '').trim() || undefined, participantMembershipIds: participants, weatherSensitive: data.get('weatherSensitive') === 'on',
    };
    const occurrenceDate = recurring && scope !== 'series' ? event.occurrenceDate : undefined;
    const outcome = await executeQueueable({ operation: 'event.update', summary: `予定「${event.title}」を変更`, payload: { id: event.id, scope, input, expectedVersion: event.version, occurrenceDate } }, () => gateway.events.updateEvent(event.id, scope, input, event.version, undefined, occurrenceDate));
    setSubmitting(false);
    if (outcome.status === 'failed') { setFormError(outcome.error.message); return; }
    if (outcome.status === 'queued') { setEditing(false); return; }
    await refresh(); setEditing(false); announce(`「${outcome.value.title}」を更新しました`);
  };
  const deleteEvent = async (event: Occurrence) => {
    const result = await gateway.events.deleteEvent(event.id, scope, event.version, event.recurrence && scope !== 'series' ? event.occurrenceDate : undefined);
    if (!result.ok) { announce(result.error.message); return; }
    setDeleting(false); setDeleted(event); close(); await refresh(); announce(`「${event.title}」${event.recurrence && scope !== 'series' ? `（${recurrenceLabel('event', scope)}）` : ''}を削除しました。7日以内は元に戻せます`);
  };
  const restoreDeleted = async () => {
    if (!deleted) return; const result = await gateway.events.restoreEvent(deleted.id);
    if (!result.ok) return announce(result.error.message);
    setDeleted(null); await refresh(); announce(`「${result.value.title}」を元に戻しました`);
  };
  const canEdit = active && can('event.update') && (['owner','adult'].includes(snapshot.viewer.role) || active.ownerMembershipId === snapshot.viewer.membershipId);
  const canDelete = active && can('event.delete') && (['owner','adult'].includes(snapshot.viewer.role) || active.ownerMembershipId === snapshot.viewer.membershipId);

  return <div className="page"><PageHeader eyebrow="予定" title="家族の予定" description="月・週・一覧表示で、家族の予定と参加者を確認できます。" action={can('event.create') ? <button data-control-id="calendar.event.create" className="button primary" type="button" onClick={() => requestQuickCreate('event')}>予定を追加</button> : undefined}/>
    {activeId && !activeEvent && <DetailNotFound what="予定" feature="calendar" backHref="/calendar"/>}
    {deleted && <div className="callout info" role="status"><CalendarIcon/><div><strong>「{deleted.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id={`calendar.event.restore.${deleted.id}`} className="button" type="button" onClick={() => void restoreDeleted()}>元に戻す</button></div>}
    <div className="calendar-layout"><section aria-label={`${monthHeading(activeMonthKey)}のカレンダー`}><div className="calendar-toolbar"><div className="calendar-month-navigation" aria-label="表示する月の移動"><button data-control-id="calendar.month.previous" className="button" type="button" onClick={() => showMonth(shiftMonthKey(activeMonthKey, -1))}>前月</button><button data-control-id="calendar.month.choose" className="calendar-month-heading" type="button" aria-haspopup="dialog" aria-expanded={monthPickerOpen} onClick={openMonthPicker}><span aria-live="polite">{monthHeading(activeMonthKey)}</span><span aria-hidden="true">⌄</span></button><button data-control-id="calendar.month.today" className="button" type="button" onClick={() => showMonth(currentMonthKey, true)}>今月</button><button data-control-id="calendar.month.next" className="button" type="button" onClick={() => showMonth(shiftMonthKey(activeMonthKey, 1))}>次月</button></div><div className="segmented" aria-label="カレンダー表示">{([['month','月'],['week','週'],['list','一覧']] as const).map(([value,label]) => <button data-control-id={`calendar.view.${value}`} key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div></div>
      {view === 'month' && <div className="month">{['日','月','火','水','木','金','土'].map((day) => <div className="weekday" key={day}>{day}</div>)}{gridDates.map((day) => { const events = eventsFor(day.date); return <button data-control-id={`calendar.day.${day.date}`} type="button" className={`day ${day.inCurrentMonth ? '' : 'outside'}`} key={day.date} aria-label={`${formatDate(`${day.date}T12:00:00+09:00`)}、予定${events.length}件`} aria-pressed={selected === day.date} onClick={() => setSelected(day.date)}><span className="date-num">{day.day}</span>{events.map((event) => <span key={event.id} className="calendar-event">{event.title}</span>)}</button>; })}</div>}
      {view === 'week' && <div className="week-view" aria-label={`${formatDate(`${week[0]}T12:00:00+09:00`)}から${formatDate(`${week[6]}T12:00:00+09:00`)}の予定`}>{week.map((date) => <section className="card flat" key={date}><h3>{formatDate(`${date}T12:00:00+09:00`)}</h3>{eventsFor(date).length ? eventsFor(date).map((event) => <button data-control-id={`calendar.event.open.${event.id}.${event.occurrenceDate}`} className="calendar-list-button" type="button" key={`${event.id}-${event.occurrenceDate}`} onClick={() => openOccurrence(event)}><time>{formatTime(event.startsAt)}</time><strong>{event.title}</strong></button>) : <p className="small muted mb-0">予定はありません</p>}</section>)}</div>}
      {view === 'list' && (monthEvents.length ? <ul className="list card flat">{monthEvents.map((event) => <li className="list-row" key={`${event.id}-${event.occurrenceDate}`}><time className="time">{formatDate(event.startsAt)}<br/>{formatTime(event.startsAt)}</time><div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所は未設定です'}</span></div><button data-control-id={`calendar.event.open.${event.id}.${event.occurrenceDate}`} className="button" type="button" aria-label={`${event.title}を開く`} onClick={() => openOccurrence(event)}>開く</button></li>)}</ul> : <EmptyState title={`${monthHeading(activeMonthKey)}の予定はありません`}>前月・次月の予定も確認できます。</EmptyState>)}
      </section><aside className="card flat" aria-labelledby="selected-day"><p className="eyebrow">選択した日</p>{selected ? <><h2 id="selected-day">{formatDate(`${selected}T12:00:00+09:00`)}</h2>{eventsFor(selected).length === 0 ? <p className="muted">この日の予定はありません。</p> : <ul className="list">{eventsFor(selected).map((event) => <li className="list-row" key={`${event.id}-${event.occurrenceDate}`}><time className="time">{formatTime(event.startsAt)}</time><div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所は未設定です'}</span></div><button data-control-id={`calendar.selected-event.open.${event.id}.${event.occurrenceDate}`} className="button" type="button" aria-label={`${event.title}を開く`} onClick={() => openOccurrence(event)}>開く</button></li>)}</ul>}</> : <><h2 id="selected-day">日付を選んでください</h2><p className="muted">カレンダーの日付を選ぶと、その日の予定を確認できます。</p></>}<hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1.5rem 0' }}/><h3>次の祝日</h3><p className="muted">{nextHoliday ? `${formatDate(`${nextHoliday.date}T12:00:00+09:00`)} ${nextHoliday.name}` : 'この月に登録されている祝日はありません。'}</p></aside></div>
    {monthPickerOpen && <Dialog title="表示する年月を選ぶ" description="1900年から2100年まで選べます。" onClose={() => setMonthPickerOpen(false)}><div className="grid two"><label className="field"><span>年</span><input data-control-id="calendar.month-picker.year" data-autofocus className="input" type="number" min={1900} max={2100} value={draftYear} onChange={(event) => setDraftYear(Number(event.target.value))}/></label><label className="field"><span>月</span><select data-control-id="calendar.month-picker.month" className="select" value={draftMonth} onChange={(event) => setDraftMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}月</option>)}</select></label></div><div className="dialog-actions"><button data-control-id="calendar.month-picker.cancel" className="button" type="button" onClick={() => setMonthPickerOpen(false)}>キャンセル</button><button data-control-id="calendar.month-picker.apply" className="button primary" type="button" disabled={!Number.isInteger(draftYear) || draftYear < 1900 || draftYear > 2100} onClick={() => { showMonth(`${draftYear}-${String(draftMonth).padStart(2, '0')}`); setMonthPickerOpen(false); }}>この年月を表示</button></div></Dialog>}
    {active && <Drawer eyebrow="予定の内容" title={active.title} onClose={close}><div className="stack"><div className="callout info"><CalendarIcon/><div><strong>{formatDate(active.startsAt)} {formatTime(active.startsAt)}〜{formatTime(active.endsAt)}</strong><p className="muted small mb-0">{timezoneLabel(active.timezone)}</p></div></div>{active.weatherSensitive && (active.occurrenceDate === todayKey ? <div className="callout"><RainIcon/><div><strong>今日の天気の影響</strong><p className="small muted mb-0">{snapshot.context.weather.location}の降水確率{snapshot.context.weather.precipitationPercent}%{snapshot.context.weather.alert ? `。${snapshot.context.weather.alert}` : ''}。予定は自動で変更されません。</p></div></div> : <div className="callout info"><RainIcon/><div><strong>天気の影響を受ける予定です</strong><p className="small muted mb-0">当日の予報を確認してください。予定は自動で変更されません。</p></div></div>)}<div className="card flat"><h3><PeopleIcon width="18"/> 参加者</h3><p>{active.participantMembershipIds.map((id) => memberName(snapshot,id)).join('、')}</p><h3>場所</h3><p>{active.location ?? '未設定'}</p>{active.note && <><h3>メモ</h3><p className="wrap">{active.note}</p></>}{active.recurrence && <><h3>繰り返し</h3><p><StatusBadge>{describeRule(dateKeyFromRfc3339(activeEvent!.startsAt), active.recurrence)}</StatusBadge> <span className="small muted">この回：{formatDate(active.startsAt)}</span></p><label className="field"><span>対象とする予定</span><select data-control-id={`calendar.event.recurrence-scope.${active.id}`} className="select" value={scope} onChange={(event) => setScope(event.target.value as RecurrenceScope)}>{(Object.keys(ja.recurrence.event) as RecurrenceScope[]).map((value) => <option key={value} value={value}>{recurrenceLabel('event', value)}</option>)}</select></label></>}</div>{resources.length ? <div><h3>関連リンク</h3><ul className="link-list">{resources.map((resource) => <li key={resource.id}><a data-control-id={`calendar.resource.${resource.id}`} href={`/settings/resources#${resource.id}`} data-link><LinkIcon width="16"/> {resource.label}</a></li>)}</ul></div> : null}{(canEdit || canDelete) && <div className="grid two">{canEdit && <button data-control-id={`calendar.event.edit.${active.id}`} className="button" type="button" onClick={() => setEditing(true)}>編集する</button>}{canDelete && <button data-control-id={`calendar.event.delete-open.${active.id}`} className="button danger" type="button" onClick={() => setDeleting(true)}>予定を削除</button>}</div>}</div></Drawer>}
    {active && editing && <Dialog title="予定を編集" description={active.recurrence ? `変更する範囲：${recurrenceLabel('event', scope)}` : 'この予定の内容を変更します。'} onClose={() => { if (!submitting) { setEditing(false); setFormError(''); } }}><form className="stack" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void updateEvent(active, event.currentTarget); }}><label className="field"><span>予定名</span><input data-control-id={`calendar.event.title.${active.id}`} className="input" name="title" required maxLength={120} defaultValue={active.title}/></label><div className="grid two"><label className="field"><span>開始</span><input data-control-id={`calendar.event.starts-at.${active.id}`} className="input" name="startsAt" type="datetime-local" required defaultValue={localValue(active.startsAt)}/></label><label className="field"><span>終了</span><input data-control-id={`calendar.event.ends-at.${active.id}`} className="input" name="endsAt" type="datetime-local" required defaultValue={localValue(active.endsAt)}/></label></div><label className="field"><span>場所</span><input data-control-id={`calendar.event.location.${active.id}`} className="input" name="location" maxLength={200} defaultValue={active.location}/></label><label className="field"><span>メモ（任意）</span><textarea data-control-id={`calendar.event.note.${active.id}`} className="textarea" name="note" maxLength={2000} defaultValue={active.note}/></label><fieldset className="fieldset"><legend>参加者</legend><div className="choice-grid">{snapshot.memberships.map((member) => <label key={member.id}><input data-control-id={`calendar.event.participant.${active.id}.${member.id}`} type="checkbox" name="participants" value={member.id} defaultChecked={active.participantMembershipIds.includes(member.id)}/>{member.displayName}</label>)}</div></fieldset><label className="check-row"><input data-control-id={`calendar.event.weather-sensitive.${active.id}`} type="checkbox" name="weatherSensitive" defaultChecked={active.weatherSensitive}/>天気の影響を表示する</label>{formError && <p className="field-error" role="alert">{formError}</p>}<div className="dialog-actions"><button data-control-id={`calendar.event.edit-cancel.${active.id}`} className="button" type="button" disabled={submitting} onClick={() => setEditing(false)}>{ja.actions.cancel}</button><button data-control-id={`calendar.event.edit-save.${active.id}`} className="button primary" type="submit" disabled={submitting}>{submitting ? ja.actions.saving : ja.actions.saveChanges}</button></div></form></Dialog>}
    {active && deleting && <Dialog title="予定を削除しますか" description={`「${active.title}」${active.recurrence ? `（${recurrenceLabel('event', scope)}）` : ''}を削除します。`} onClose={() => setDeleting(false)} actions={<><button data-control-id={`calendar.event.delete-cancel.${active.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button><button data-control-id={`calendar.event.delete-confirm.${active.id}`} className="button danger" type="button" onClick={() => void deleteEvent(active)}>{ja.actions.delete}</button></>}><p className="muted">削除すると、共有相手の画面にも表示されなくなります。7日以内なら元に戻せます。</p></Dialog>}
  </div>;
}
