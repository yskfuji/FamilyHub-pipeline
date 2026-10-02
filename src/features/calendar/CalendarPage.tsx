import { useEffect, useMemo, useState } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { detailId, navigate, useCloseTo } from '../../app/router';
import { Dialog, Drawer, EmptyState, PageHeader, StatusBadge, formatDate, formatTime } from '../../design-system/components';
import { CalendarIcon, LinkIcon, PeopleIcon, RainIcon } from '../../design-system/icons';
import type { CalendarEvent, RecurrenceScope } from '../../domain/types';
import { calendarMonthFromUrl, dateKeyFromRfc3339, monthGrid, monthKeyFromRfc3339, normalizeSelectedDate, shiftMonthKey, urlWithCalendarMonth, weekDates } from '../../domain/calendarDate';
import { ja, recurrenceLabel } from '../../content/ja';

const localValue = (value: string) => value.slice(0, 16);
const rfcValue = (value: string) => `${value}:00+09:00`;
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
  const active = snapshot.events.find((event) => event.id === activeId);
  const close = useCloseTo('/calendar');
  const eventsFor = (date: string) => snapshot.events.filter((event) => dateKeyFromRfc3339(event.startsAt) === date);
  const gridDates = useMemo(() => monthGrid(activeMonthKey), [activeMonthKey]);
  const week = useMemo(() => weekDates(selected ?? `${activeMonthKey}-01`), [activeMonthKey, selected]);
  const monthEvents = useMemo(
    () => snapshot.events.filter((event) => monthKeyFromRfc3339(event.startsAt) === activeMonthKey).sort((a,b) => a.startsAt.localeCompare(b.startsAt)),
    [activeMonthKey, snapshot.events],
  );
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

  const updateEvent = async (event: CalendarEvent, form: HTMLFormElement) => {
    if (submitting) return; setFormError(''); setSubmitting(true);
    const data = new FormData(form);
    const participants = data.getAll('participants').map(String);
    if (!participants.length) { setFormError('参加者を1人以上選んでください。'); setSubmitting(false); return; }
    const input = {
      title: String(data.get('title') ?? '').trim(), startsAt: rfcValue(String(data.get('startsAt'))), endsAt: rfcValue(String(data.get('endsAt'))),
      location: String(data.get('location') ?? '').trim() || undefined, participantMembershipIds: participants, weatherSensitive: data.get('weatherSensitive') === 'on',
    };
    const outcome = await executeQueueable({ operation: 'event.update', summary: `予定「${event.title}」を変更`, payload: { id: event.id, scope, input, expectedVersion: event.version } }, () => gateway.events.updateEvent(event.id, scope, input, event.version));
    setSubmitting(false);
    if (outcome.status === 'failed') { setFormError(outcome.error.message); return; }
    if (outcome.status === 'queued') { setEditing(false); return; }
    await refresh(); setEditing(false); announce(`「${outcome.value.title}」を更新しました`);
  };
  const deleteEvent = async (event: CalendarEvent) => {
    const result = await gateway.events.deleteEvent(event.id, scope, event.version);
    if (!result.ok) { announce(result.error.message); return; }
    await refresh(); setDeleting(false); setDeleted(event); announce(`「${event.title}」を削除しました。7日以内は元に戻せます`); close();
  };
  const restoreDeleted = async () => {
    if (!deleted) return; const result = await gateway.events.restoreEvent(deleted.id);
    if (!result.ok) return announce(result.error.message);
    setDeleted(null); await refresh(); announce(`「${result.value.title}」を元に戻しました`);
  };
  const canEdit = active && can('event.update') && (['owner','adult'].includes(snapshot.viewer.role) || active.ownerMembershipId === snapshot.viewer.membershipId);
  const canDelete = active && can('event.delete') && (['owner','adult'].includes(snapshot.viewer.role) || active.ownerMembershipId === snapshot.viewer.membershipId);

  return <div className="page"><PageHeader eyebrow="予定" title="家族の予定" description="月・週・一覧表示で、家族の予定と参加者を確認できます。" action={can('event.create') ? <button data-control-id="calendar.event.create" className="button primary" type="button" onClick={() => requestQuickCreate('event')}>予定を追加</button> : undefined}/>
    {deleted && <div className="callout info" role="status"><CalendarIcon/><div><strong>「{deleted.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id={`calendar.event.restore.${deleted.id}`} className="button" type="button" onClick={() => void restoreDeleted()}>元に戻す</button></div>}
    <div className="calendar-layout"><section aria-label={`${monthHeading(activeMonthKey)}のカレンダー`}><div className="calendar-toolbar"><div className="calendar-month-navigation" aria-label="表示する月の移動"><button data-control-id="calendar.month.previous" className="button" type="button" onClick={() => showMonth(shiftMonthKey(activeMonthKey, -1))}>前月</button><button data-control-id="calendar.month.choose" className="calendar-month-heading" type="button" aria-haspopup="dialog" aria-expanded={monthPickerOpen} onClick={openMonthPicker}><span aria-live="polite">{monthHeading(activeMonthKey)}</span><span aria-hidden="true">⌄</span></button><button data-control-id="calendar.month.today" className="button" type="button" onClick={() => showMonth(currentMonthKey, true)}>今月</button><button data-control-id="calendar.month.next" className="button" type="button" onClick={() => showMonth(shiftMonthKey(activeMonthKey, 1))}>次月</button></div><div className="segmented" aria-label="カレンダー表示">{([['month','月'],['week','週'],['list','一覧']] as const).map(([value,label]) => <button data-control-id={`calendar.view.${value}`} key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div></div>
      {view === 'month' && <div className="month">{['日','月','火','水','木','金','土'].map((day) => <div className="weekday" key={day}>{day}</div>)}{gridDates.map((day) => { const events = eventsFor(day.date); return <button data-control-id={`calendar.day.${day.date}`} type="button" className={`day ${day.inCurrentMonth ? '' : 'outside'}`} key={day.date} aria-label={`${formatDate(`${day.date}T12:00:00+09:00`)}、予定${events.length}件`} aria-pressed={selected === day.date} onClick={() => setSelected(day.date)}><span className="date-num">{day.day}</span>{events.map((event) => <span key={event.id} className="calendar-event">{event.title}</span>)}</button>; })}</div>}
      {view === 'week' && <div className="week-view" aria-label={`${formatDate(`${week[0]}T12:00:00+09:00`)}から${formatDate(`${week[6]}T12:00:00+09:00`)}の予定`}>{week.map((date) => <section className="card flat" key={date}><h3>{formatDate(`${date}T12:00:00+09:00`)}</h3>{eventsFor(date).length ? eventsFor(date).map((event) => <button data-control-id={`calendar.event.open.${event.id}`} className="calendar-list-button" type="button" key={event.id} onClick={() => navigate(`/calendar/${event.id}?month=${activeMonthKey}`)}><time>{formatTime(event.startsAt)}</time><strong>{event.title}</strong></button>) : <p className="small muted mb-0">予定はありません</p>}</section>)}</div>}
      {view === 'list' && (monthEvents.length ? <ul className="list card flat">{monthEvents.map((event) => <li className="list-row" key={event.id}><time className="time">{formatDate(event.startsAt)}<br/>{formatTime(event.startsAt)}</time><div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所は未設定です'}</span></div><button data-control-id={`calendar.event.open.${event.id}`} className="button" type="button" aria-label={`${event.title}を開く`} onClick={() => navigate(`/calendar/${event.id}?month=${activeMonthKey}`)}>開く</button></li>)}</ul> : <EmptyState title={`${monthHeading(activeMonthKey)}の予定はありません`}>前月・次月の予定も確認できます。</EmptyState>)}
      </section><aside className="card flat" aria-labelledby="selected-day"><p className="eyebrow">選択した日</p>{selected ? <><h2 id="selected-day">{formatDate(`${selected}T12:00:00+09:00`)}</h2>{eventsFor(selected).length === 0 ? <p className="muted">この日の予定はありません。</p> : <ul className="list">{eventsFor(selected).map((event) => <li className="list-row" key={event.id}><time className="time">{formatTime(event.startsAt)}</time><div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所は未設定です'}</span></div><button data-control-id={`calendar.selected-event.open.${event.id}`} className="button" type="button" aria-label={`${event.title}を開く`} onClick={() => navigate(`/calendar/${event.id}?month=${activeMonthKey}`)}>開く</button></li>)}</ul>}</> : <><h2 id="selected-day">日付を選んでください</h2><p className="muted">カレンダーの日付を選ぶと、その日の予定を確認できます。</p></>}<hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1.5rem 0' }}/><h3>次の祝日</h3><p className="muted">{nextHoliday ? `${formatDate(`${nextHoliday.date}T12:00:00+09:00`)} ${nextHoliday.name}` : 'この月に登録されている祝日はありません。'}</p></aside></div>
    {monthPickerOpen && <Dialog title="表示する年月を選ぶ" description="1900年から2100年まで選べます。" onClose={() => setMonthPickerOpen(false)}><div className="grid two"><label className="field"><span>年</span><input data-control-id="calendar.month-picker.year" data-autofocus className="input" type="number" min={1900} max={2100} value={draftYear} onChange={(event) => setDraftYear(Number(event.target.value))}/></label><label className="field"><span>月</span><select data-control-id="calendar.month-picker.month" className="select" value={draftMonth} onChange={(event) => setDraftMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}月</option>)}</select></label></div><div className="dialog-actions"><button data-control-id="calendar.month-picker.cancel" className="button" type="button" onClick={() => setMonthPickerOpen(false)}>キャンセル</button><button data-control-id="calendar.month-picker.apply" className="button primary" type="button" disabled={!Number.isInteger(draftYear) || draftYear < 1900 || draftYear > 2100} onClick={() => { showMonth(`${draftYear}-${String(draftMonth).padStart(2, '0')}`); setMonthPickerOpen(false); }}>この年月を表示</button></div></Dialog>}
    {active && <Drawer eyebrow="予定の内容" title={active.title} onClose={close}><div className="stack"><div className="callout info"><CalendarIcon/><div><strong>{formatDate(active.startsAt)} {formatTime(active.startsAt)}〜{formatTime(active.endsAt)}</strong><p className="muted small mb-0">日本時間</p></div></div>{active.weatherSensitive && <div className="callout"><RainIcon/><div><strong>天気の影響</strong><p className="small muted mb-0">降水確率80%。予定は自動で変更されません。</p></div></div>}<div className="card flat"><h3><PeopleIcon width="18"/> 参加者</h3><p>{active.participantMembershipIds.map((id) => memberName(snapshot,id)).join('、')}</p><h3>場所</h3><p>{active.location ?? '未設定'}</p>{active.recurrence && <><h3>繰り返し</h3><p><StatusBadge>毎週</StatusBadge> <span className="small muted">繰り返し予定</span></p><label className="field"><span>対象とする予定</span><select data-control-id={`calendar.event.recurrence-scope.${active.id}`} className="select" value={scope} onChange={(event) => setScope(event.target.value as RecurrenceScope)}>{(Object.keys(ja.recurrence.event) as RecurrenceScope[]).map((value) => <option key={value} value={value}>{recurrenceLabel('event', value)}</option>)}</select></label></>}</div>{active.resourceIds?.length ? <div><h3>関連リンク</h3><a data-control-id="calendar.resource.school" href="/settings/resources" data-link><LinkIcon width="16"/> 青葉小学校の保護者向けページ</a></div> : null}{(canEdit || canDelete) && <div className="grid two">{canEdit && <button data-control-id={`calendar.event.edit.${active.id}`} className="button" type="button" onClick={() => setEditing(true)}>編集する</button>}{canDelete && <button data-control-id={`calendar.event.delete-open.${active.id}`} className="button danger" type="button" onClick={() => setDeleting(true)}>予定を削除</button>}</div>}</div></Drawer>}
    {active && editing && <Dialog title="予定を編集" description={active.recurrence ? `変更する範囲：${recurrenceLabel('event', scope)}` : 'この予定の内容を変更します。'} onClose={() => { if (!submitting) { setEditing(false); setFormError(''); } }}><form className="stack" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void updateEvent(active, event.currentTarget); }}><label className="field"><span>予定名</span><input data-control-id={`calendar.event.title.${active.id}`} className="input" name="title" required maxLength={120} defaultValue={active.title}/></label><div className="grid two"><label className="field"><span>開始</span><input data-control-id={`calendar.event.starts-at.${active.id}`} className="input" name="startsAt" type="datetime-local" required defaultValue={localValue(active.startsAt)}/></label><label className="field"><span>終了</span><input data-control-id={`calendar.event.ends-at.${active.id}`} className="input" name="endsAt" type="datetime-local" required defaultValue={localValue(active.endsAt)}/></label></div><label className="field"><span>場所</span><input data-control-id={`calendar.event.location.${active.id}`} className="input" name="location" maxLength={200} defaultValue={active.location}/></label><fieldset className="fieldset"><legend>参加者</legend><div className="choice-grid">{snapshot.memberships.map((member) => <label key={member.id}><input data-control-id={`calendar.event.participant.${active.id}.${member.id}`} type="checkbox" name="participants" value={member.id} defaultChecked={active.participantMembershipIds.includes(member.id)}/>{member.displayName}</label>)}</div></fieldset><label className="check-row"><input data-control-id={`calendar.event.weather-sensitive.${active.id}`} type="checkbox" name="weatherSensitive" defaultChecked={active.weatherSensitive}/>天気の影響を表示する</label>{formError && <p className="field-error" role="alert">{formError}</p>}<div className="dialog-actions"><button data-control-id={`calendar.event.edit-cancel.${active.id}`} className="button" type="button" disabled={submitting} onClick={() => setEditing(false)}>{ja.actions.cancel}</button><button data-control-id={`calendar.event.edit-save.${active.id}`} className="button primary" type="submit" disabled={submitting}>{submitting ? ja.actions.saving : ja.actions.saveChanges}</button></div></form></Dialog>}
    {active && deleting && <Dialog title="予定を削除しますか" description={`「${active.title}」${active.recurrence ? `（${recurrenceLabel('event', scope)}）` : ''}を削除します。`} onClose={() => setDeleting(false)} actions={<><button data-control-id={`calendar.event.delete-cancel.${active.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button><button data-control-id={`calendar.event.delete-confirm.${active.id}`} className="button danger" type="button" onClick={() => void deleteEvent(active)}>{ja.actions.delete}</button></>}><p className="muted">削除すると、共有相手の画面にも表示されなくなります。7日以内なら元に戻せます。</p></Dialog>}
  </div>;
}
