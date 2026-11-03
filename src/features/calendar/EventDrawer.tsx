import { useState } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { canDeleteResource, canMutateOwnedResource } from '../../authz/policy';
import { Dialog, Drawer, StatusBadge } from '../../design-system/components';
import { CalendarIcon, LinkIcon, PeopleIcon, RainIcon } from '../../design-system/icons';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import type { Occurrence } from '../../domain/calendarLayout';
import { draftToUpdateInput, eventToDraft, reminderLabel, seriesEditPreview, type EventDraft } from '../../domain/eventForm';
import { describeRule } from '../../domain/recurrence';
import { eventUpdateSchema } from '../../domain/schemas';
import type { CalendarEvent, IsoDate, RecurrenceScope } from '../../domain/types';
import { ja, recurrenceLabel } from '../../content/ja';
import { EventForm } from './EventForm';
import { dayLabel, timezoneLabel, whenLabel } from './calendarLabels';

/** 元に戻すために覚えておく、削除した範囲。 */
export interface DeletedEvent { event: Occurrence; occurrenceDate?: IsoDate }

interface Props {
  active: Occurrence;
  /** 繰り返しを展開する前の元の予定。 */
  series: CalendarEvent;
  onClose: () => void;
  onDeleted: (deleted: DeletedEvent) => void;
}

/** 開いた回ではなく、シリーズの開始日で規則を読む（曜日の判定が開始日によるため）。 */
const recurrenceOf = (series: CalendarEvent) => {
  const { recurrence, intervalDays, until } = eventToDraft(series);
  return { recurrence, intervalDays, until };
};

export function EventDrawer({ active, series, onClose, onDeleted }: Props) {
  const { snapshot, gateway, refresh, announce, can, executeQueueable } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scope, setScope] = useState<RecurrenceScope>('this');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const todayKey = dateKeyFromRfc3339(snapshot.context.asOf);
  const seriesStart = dateKeyFromRfc3339(series.startsAt);
  const viewer = snapshot.viewer;
  const canEdit = canMutateOwnedResource(viewer, 'event.update', active.ownerMembershipId).allowed;
  const canDelete = canDeleteResource(viewer, 'event.delete', [active.ownerMembershipId, ...active.participantMembershipIds]).allowed;
  const resources = can('resource.read') ? snapshot.resources.filter((resource) => active.resourceIds?.includes(resource.id)) : [];
  const recurring = Boolean(active.recurrence);
  const label = active.colorLabelId ? snapshot.colorLabels.find((item) => item.id === active.colorLabelId)?.name : undefined;
  const audience = active.visibility.audience === 'selected' ? active.visibility.selectedMembershipIds.map((id) => memberName(snapshot, id)).join('、') : ja.visibility[active.visibility.audience];
  // 1回だけの変更と分割では、規則はシリーズから決まるので変えられない。
  const recurrenceEditable = !recurring || scope === 'series';

  const update = async (draft: EventDraft) => {
    if (submitting) return;
    setFormError(''); setSubmitting(true);
    const wholeSeries = recurring && scope === 'series';
    // 日付を動かすときは、シリーズ全体を同じ日数だけずらす。ずらせない規則は理由を示して送らない（確かめの文の表示は後の段階）。
    const preview = wholeSeries ? seriesEditPreview(draft, series, active.occurrenceDate, recurrenceEditable) : null;
    if (preview?.kind === 'refused') { setFormError(preview.text); setSubmitting(false); return; }
    const input = draftToUpdateInput(draft, series, { recurrenceEditable, seriesStart: wholeSeries ? seriesStart : undefined, occurrenceDate: wholeSeries ? active.occurrenceDate : undefined });
    const parsed = eventUpdateSchema.safeParse(input);
    if (!parsed.success) { setFormError(parsed.error.issues[0]?.message ?? '入力内容を確認してください。'); setSubmitting(false); return; }
    const occurrenceDate = recurring && scope !== 'series' ? active.occurrenceDate : undefined;
    const outcome = await executeQueueable({ operation: 'event.update', summary: `予定「${active.title}」を変更`, payload: { id: active.id, scope, input, expectedVersion: active.version, occurrenceDate } }, () => gateway.events.updateEvent(active.id, scope, input, active.version, undefined, occurrenceDate));
    setSubmitting(false);
    if (outcome.status === 'failed') { setFormError(outcome.error.message); return; }
    setEditing(false);
    if (outcome.status === 'queued') return;
    await refresh();
    announce(`「${outcome.value.title}」を更新しました`);
  };
  const remove = async () => {
    const occurrenceDate = recurring && scope !== 'series' ? active.occurrenceDate : undefined;
    const result = await gateway.events.deleteEvent(active.id, scope, active.version, occurrenceDate);
    if (!result.ok) { announce(result.error.message); return; }
    setDeleting(false);
    // 1回だけの削除は、その回を指定して戻す。これ以降の削除は、シリーズの記録から戻す。
    onDeleted({ event: active, occurrenceDate: recurring && scope === 'this' ? active.occurrenceDate : undefined });
    onClose();
    await refresh();
    announce(`「${active.title}」${recurring && scope !== 'series' ? `（${recurrenceLabel('event', scope)}）` : ''}を削除しました。7日以内は元に戻せます`);
  };

  return <>
    <Drawer eyebrow="予定の内容" title={active.title} onClose={onClose}><div className="stack">
      <div className="callout info"><CalendarIcon/><div><strong>{whenLabel(active)}</strong><p className="muted small mb-0">{timezoneLabel(active.timezone)}</p></div></div>
      {active.weatherSensitive && (active.occurrenceDate === todayKey
        ? <div className="callout"><RainIcon/><div><strong>今日の天気の影響</strong><p className="small muted mb-0">{snapshot.context.weather.location}の降水確率{snapshot.context.weather.precipitationPercent}%{snapshot.context.weather.alert ? `。${snapshot.context.weather.alert}` : ''}。予定は自動で変更されません。</p></div></div>
        : <div className="callout info"><RainIcon/><div><strong>天気の影響を受ける予定です</strong><p className="small muted mb-0">当日の予報を確認してください。予定は自動で変更されません。</p></div></div>)}
      <div className="card flat">
        <h3><PeopleIcon width="18"/> 参加者</h3><p>{active.participantMembershipIds.map((id) => memberName(snapshot, id)).join('、')}</p>
        <h3>場所</h3><p>{active.location ?? '未設定'}</p>
        {active.note && <><h3>メモ</h3><p className="wrap">{active.note}</p></>}
        <h3>公開範囲</h3><p>{audience}</p>
        {label && <><h3>リスト</h3><p>{label}</p></>}
        {active.reminderMinutesBefore !== undefined && <><h3>通知</h3><p>{reminderLabel(active.reminderMinutesBefore)}</p></>}
        {active.recurrence && <><h3>繰り返し</h3><p><StatusBadge>{describeRule(seriesStart, active.recurrence)}</StatusBadge> <span className="small muted">この回：{dayLabel(active.occurrenceDate)}</span></p>
          <label className="field"><span>対象とする予定</span><select data-control-id={`calendar.event.recurrence-scope.${active.id}`} className="select" value={scope} onChange={(event) => setScope(event.target.value as RecurrenceScope)}>{(Object.keys(ja.recurrence.event) as RecurrenceScope[]).map((value) => <option key={value} value={value}>{recurrenceLabel('event', value)}</option>)}</select></label>
        </>}
      </div>
      {resources.length > 0 && <div><h3>関連リンク</h3><ul className="link-list">{resources.map((resource) => <li key={resource.id}><a data-control-id={`calendar.resource.${resource.id}`} href={`/settings/resources#${resource.id}`} data-link><LinkIcon width="16"/> {resource.label}</a></li>)}</ul></div>}
      {(canEdit || canDelete) && <div className="grid two">
        {canEdit && <button data-control-id={`calendar.event.edit.${active.id}`} className="button" type="button" onClick={() => setEditing(true)}>編集する</button>}
        {canDelete && <button data-control-id={`calendar.event.delete-open.${active.id}`} className="button danger" type="button" onClick={() => setDeleting(true)}>予定を削除</button>}
      </div>}
    </div></Drawer>
    {editing && <Dialog title="予定を編集" description={recurring ? `変更する範囲：${recurrenceLabel('event', scope)}` : 'この予定の内容を変更します。'} onClose={() => { if (!submitting) { setEditing(false); setFormError(''); } }}>
      <EventForm formId={active.id} initial={{ ...eventToDraft(active), ...(recurring ? recurrenceOf(series) : {}) }} submitLabel={ja.actions.saveChanges} busy={submitting} error={formError} keptRuleLabel={active.recurrence ? describeRule(seriesStart, active.recurrence) : undefined} recurrenceNote={recurrenceEditable ? undefined : `繰り返しの変更は、対象を「${recurrenceLabel('event', 'series')}」にすると行えます。`} onSubmit={(draft) => void update(draft)} onCancel={() => { setEditing(false); setFormError(''); }}/>
    </Dialog>}
    {deleting && <Dialog title="予定を削除しますか" description={`「${active.title}」${recurring ? `（${recurrenceLabel('event', scope)}）` : ''}を削除します。`} onClose={() => setDeleting(false)} actions={<>
      <button data-control-id={`calendar.event.delete-cancel.${active.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button>
      <button data-control-id={`calendar.event.delete-confirm.${active.id}`} className="button danger" type="button" onClick={() => void remove()}>{ja.actions.delete}</button>
    </>}><p className="muted">削除すると、共有相手の画面にも表示されなくなります。7日以内なら元に戻せます。</p></Dialog>}
  </>;
}
