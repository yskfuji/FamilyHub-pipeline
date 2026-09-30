import { useState } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { detailId, navigate, useCloseTo } from '../../app/router';
import { Dialog, Drawer, EmptyState, PageHeader, StatusBadge, formatDate, formatTime } from '../../design-system/components';
import { CalendarIcon, LinkIcon, PeopleIcon, RainIcon } from '../../design-system/icons';
import type { CalendarEvent, RecurrenceScope } from '../../domain/types';

const dates = [28,29,30,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,1];
const isoFor = (index: number, day: number) => index < 3 ? `2026-09-${day}` : index > 33 ? '2026-11-01' : `2026-10-${String(day).padStart(2,'0')}`;
const localValue = (value: string) => value.slice(0, 16);
const rfcValue = (value: string) => `${value}:00+09:00`;

export function CalendarPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [selected, setSelected] = useState('2026-09-30');
  const [view, setView] = useState<'month'|'week'|'list'>('month');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scope, setScope] = useState<RecurrenceScope>('this');
  const [formError, setFormError] = useState('');
  const activeId = detailId(path, '/calendar');
  const active = snapshot.events.find((event) => event.id === activeId);
  const close = useCloseTo('/calendar');
  const eventsFor = (date: string) => snapshot.events.filter((event) => event.startsAt.slice(0,10) === date);

  const updateEvent = async (event: CalendarEvent, form: HTMLFormElement) => {
    setFormError('');
    const data = new FormData(form);
    const participants = data.getAll('participants').map(String);
    if (!participants.length) { setFormError('関係する人を1人以上選んでください。'); return; }
    const result = await gateway.events.updateEvent(event.id, scope, {
      title: String(data.get('title') ?? '').trim(), startsAt: rfcValue(String(data.get('startsAt'))), endsAt: rfcValue(String(data.get('endsAt'))),
      location: String(data.get('location') ?? '').trim() || undefined, participantMembershipIds: participants, weatherSensitive: data.get('weatherSensitive') === 'on',
    }, event.version);
    if (!result.ok) { setFormError(result.error.message); return; }
    await refresh(); setEditing(false); announce(`「${result.value.title}」を更新しました`);
  };
  const deleteEvent = async (event: CalendarEvent) => {
    const result = await gateway.events.deleteEvent(event.id, scope, event.version);
    if (!result.ok) { announce(result.error.message); return; }
    await refresh(); setDeleting(false); announce(`「${event.title}」を削除しました`); close();
  };

  return <div className="page"><PageHeader eyebrow="Calendar" title="家族の予定" description="一日、一週間、繰り返し。その予定が誰に関係するかまで見渡せます。" action={<button className="button primary" type="button" onClick={() => document.querySelector<HTMLButtonElement>('.quick-create')?.click()}>予定を追加</button>}/>
    {snapshot.events.length === 0 ? <EmptyState title="予定はまだありません">最初の予定を作ると、家族の時間軸が始まります。</EmptyState> : <div className="calendar-layout"><section aria-label="2026年10月のカレンダー"><div className="section-head"><h2>2026年 10月</h2><div className="segmented" aria-label="カレンダー表示">{([['month','月'],['week','週'],['list','一覧']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</div></div>
      {view === 'month' && <div className="month">{['日','月','火','水','木','金','土'].map((day) => <div className="weekday" key={day}>{day}</div>)}{dates.map((day,index) => { const iso = isoFor(index,day); const events = eventsFor(iso); return <button type="button" className={`day ${index < 3 || index > 33 ? 'outside' : ''}`} key={`${iso}-${index}`} aria-label={`${iso}、予定${events.length}件`} aria-pressed={selected === iso} onClick={() => setSelected(iso)}><span className="date-num">{day}</span>{events.map((event) => <span key={event.id} className="calendar-event">{event.title}</span>)}</button>; })}</div>}
      {view === 'week' && <div className="week-view" aria-label="9月28日から10月4日の予定">{['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04'].map((date) => <section className="card flat" key={date}><h3>{formatDate(`${date}T12:00:00+09:00`)}</h3>{eventsFor(date).length ? eventsFor(date).map((event) => <button className="calendar-list-button" type="button" key={event.id} onClick={() => navigate(`/calendar/${event.id}`)}><time>{formatTime(event.startsAt)}</time><strong>{event.title}</strong></button>) : <p className="small muted mb-0">予定なし</p>}</section>)}</div>}
      {view === 'list' && <ul className="list card flat">{[...snapshot.events].sort((a,b) => a.startsAt.localeCompare(b.startsAt)).map((event) => <li className="list-row" key={event.id}><time className="time">{formatDate(event.startsAt)}<br/>{formatTime(event.startsAt)}</time><div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所未設定'}</span></div><button className="button" type="button" onClick={() => navigate(`/calendar/${event.id}`)}>詳細</button></li>)}</ul>}
      </section><aside className="card flat" aria-labelledby="selected-day"><p className="eyebrow">Selected day</p><h2 id="selected-day">{formatDate(`${selected}T12:00:00+09:00`)}</h2>{eventsFor(selected).length === 0 ? <p className="muted">予定はありません。余白も家族の時間です。</p> : <ul className="list">{eventsFor(selected).map((event) => <li className="list-row" key={event.id}><time className="time">{formatTime(event.startsAt)}</time><div className="row-main"><strong>{event.title}</strong><span className="meta">{event.location ?? '場所未設定'}</span></div><button className="button" type="button" onClick={() => navigate(`/calendar/${event.id}`)}>詳細</button></li>)}</ul>}<hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1.5rem 0' }}/><h3>次の祝日</h3><p className="muted">10月12日（月）スポーツの日</p></aside></div>}
    {active && <Drawer eyebrow="Event detail" title={active.title} onClose={close}><div className="stack"><div className="callout info"><CalendarIcon/><div><strong>{formatDate(active.startsAt)} {formatTime(active.startsAt)}〜{formatTime(active.endsAt)}</strong><p className="muted small mb-0">{active.timezone}</p></div></div>{active.weatherSensitive && <div className="callout"><RainIcon/><div><strong>雨の影響候補</strong><p className="small muted mb-0">降水確率80%。自動変更はしません。</p></div></div>}<div className="card flat"><h3><PeopleIcon width="18"/> 関係する人</h3><p>{active.participantMembershipIds.map((id) => memberName(snapshot,id)).join('、')}</p><h3>場所</h3><p>{active.location ?? '未設定'}</p>{active.recurrence && <><h3>繰り返し</h3><p><StatusBadge>毎週</StatusBadge> <code>{active.recurrence.rrule}</code></p><label className="field"><span>編集対象</span><select className="select" value={scope} onChange={(event) => setScope(event.target.value as RecurrenceScope)}><option value="this">今回のみ</option><option value="future">今回以降</option><option value="series">系列全体</option></select></label></>}</div>{active.resourceIds?.length ? <div><h3>関連リソース</h3><a href="/settings/resources" data-link><LinkIcon width="16"/> 青葉小学校 保護者ページ</a></div> : null}<div className="grid two"><button className="button" type="button" onClick={() => setEditing(true)}>編集する</button><button className="button danger" type="button" onClick={() => setDeleting(true)}>予定を削除</button></div></div></Drawer>}
    {active && editing && <Dialog title="予定を編集" description={active.recurrence ? `対象: ${scope === 'this' ? '今回のみ' : scope === 'future' ? '今回以降' : '系列全体'}` : 'この予定を更新します'} onClose={() => { setEditing(false); setFormError(''); }}><form className="stack" onSubmit={(event) => { event.preventDefault(); void updateEvent(active, event.currentTarget); }}><label className="field"><span>予定名</span><input className="input" name="title" required maxLength={120} defaultValue={active.title}/></label><div className="grid two"><label className="field"><span>開始</span><input className="input" name="startsAt" type="datetime-local" required defaultValue={localValue(active.startsAt)}/></label><label className="field"><span>終了</span><input className="input" name="endsAt" type="datetime-local" required defaultValue={localValue(active.endsAt)}/></label></div><label className="field"><span>場所</span><input className="input" name="location" maxLength={200} defaultValue={active.location}/></label><fieldset className="fieldset"><legend>関係する人</legend><div className="choice-grid">{snapshot.memberships.map((member) => <label key={member.id}><input type="checkbox" name="participants" value={member.id} defaultChecked={active.participantMembershipIds.includes(member.id)}/>{member.displayName}</label>)}</div></fieldset><label className="check-row"><input type="checkbox" name="weatherSensitive" defaultChecked={active.weatherSensitive}/>天候による影響を確認する</label>{formError && <p className="field-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button" type="button" onClick={() => setEditing(false)}>キャンセル</button><button className="button primary" type="submit">変更を保存</button></div></form></Dialog>}
    {active && deleting && <Dialog title="予定を削除しますか" description={`「${active.title}」${active.recurrence ? `（${scope === 'this' ? '今回のみ' : scope === 'future' ? '今回以降' : '系列全体'}）` : ''}を削除します。`} onClose={() => setDeleting(false)} actions={<><button className="button" type="button" onClick={() => setDeleting(false)}>キャンセル</button><button className="button danger" type="button" onClick={() => void deleteEvent(active)}>削除する</button></>}><p className="muted">この操作はモック状態に反映されます。実サービスではサーバー側の認可・競合検査・監査記録が必要です。</p></Dialog>}
  </div>;
}
