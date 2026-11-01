import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useApp } from '../../app/AppContext';
import { allowedAudiencesFor } from '../../authz/policy';
import { ja } from '../../content/ja';
import { MAX_SELECTED_MEMBERS, applyTemplate, draftProblem, pastEventTemplates, reminderChoices, reminderLabel, withStart, type EventDraft, type RecurrenceChoice } from '../../domain/eventForm';
import type { VisibilityAudience } from '../../domain/types';
import { labelStyle } from './calendarLabels';

const recurrenceOptions: ReadonlyArray<readonly [RecurrenceChoice, string]> = [['none', '繰り返さない'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月'], ['month-end', '毎月の末日'], ['every-n-days', '日数を指定']];

interface Props {
  /** 操作の ID の末尾に使う。新規は new。 */
  formId: string;
  initial: EventDraft;
  submitLabel: string;
  busy: boolean;
  error: string;
  /** 新規のとき、過去の予定から内容を入れられるようにする。 */
  offerTemplates?: boolean;
  /** 繰り返しを変えられないときの説明。 */
  recurrenceNote?: ReactNode;
  /** 今の規則がこの画面で作れないときの表示名。 */
  keptRuleLabel?: string;
  onSubmit: (draft: EventDraft) => void;
  onCancel: () => void;
}

export function EventForm({ formId, initial, submitLabel, busy, error, offerTemplates, recurrenceNote, keptRuleLabel, onSubmit, onCancel }: Props) {
  const { snapshot } = useApp();
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState('');
  const patch = (changes: Partial<EventDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const allowed = allowedAudiencesFor(snapshot.viewer.role);
  // 選べない範囲の予定でも、今の範囲は表示する（変えなければ送らない）。
  const audiences = useMemo<readonly VisibilityAudience[]>(() => (allowed.includes(initial.audience) ? allowed : [initial.audience, ...allowed]), [allowed, initial.audience]);
  const people = snapshot.memberships.filter((member) => member.status === 'active' || draft.participantIds.includes(member.id) || draft.selectedIds.includes(member.id));
  const templates = useMemo(() => (offerTemplates ? pastEventTemplates(snapshot.events, snapshot.context.asOf) : []), [offerTemplates, snapshot.events, snapshot.context.asOf]);
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((item) => item !== id));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = draftProblem(draft, !recurrenceNote);
    setProblem(found ?? '');
    if (!found) onSubmit(draft);
  };
  const shown = problem || error;
  return <form className="stack" aria-busy={busy} noValidate onSubmit={submit}>
    {templates.length > 0 && <div className="event-templates" role="group" aria-label="過去の予定から入力">
      <span className="field-help">過去の予定から入力</span>
      <div className="event-template-list">{templates.map((template) => <button data-control-id={`calendar.event.template.${template.id}`} className="button" type="button" key={template.id} aria-label={`「${template.title}」の内容を入れる`} onClick={() => setDraft((current) => applyTemplate(current, template, { allowedAudiences: allowed, memberIds: people.map((member) => member.id) }))}>{template.title}</button>)}</div>
    </div>}
    <label className="field"><span>予定名</span><input data-control-id={`calendar.event.title.${formId}`} className="input" name="title" autoFocus required maxLength={120} value={draft.title} onChange={(event) => patch({ title: event.target.value })}/></label>
    <label className="check-row"><input data-control-id={`calendar.event.all-day.${formId}`} type="checkbox" checked={draft.allDay} onChange={(event) => patch({ allDay: event.target.checked })}/>終日</label>
    {draft.allDay
      ? <div className="grid two">
        <label className="field"><span>開始日</span><input data-control-id={`calendar.event.starts-on.${formId}`} className="input" type="date" required value={draft.start.slice(0, 10)} onChange={(event) => { if (event.target.value) setDraft((current) => withStart(current, `${event.target.value}T${current.start.slice(11, 16) || '00:00'}`)); }}/></label>
        <label className="field"><span>終了日</span><input data-control-id={`calendar.event.ends-on.${formId}`} className="input" type="date" required value={draft.end.slice(0, 10)} onChange={(event) => { if (event.target.value) patch({ end: `${event.target.value}T${draft.end.slice(11, 16) || '23:59'}` }); }}/></label>
      </div>
      : <div className="grid two">
        <label className="field"><span>開始</span><input data-control-id={`calendar.event.starts-at.${formId}`} className="input" type="datetime-local" required value={draft.start} onChange={(event) => setDraft((current) => withStart(current, event.target.value))}/></label>
        <label className="field"><span>終了</span><input data-control-id={`calendar.event.ends-at.${formId}`} className="input" type="datetime-local" required value={draft.end} onChange={(event) => patch({ end: event.target.value })}/></label>
      </div>}
    <label className="field"><span>場所（任意）</span><input data-control-id={`calendar.event.location.${formId}`} className="input" maxLength={200} value={draft.location} onChange={(event) => patch({ location: event.target.value })}/></label>
    <label className="field"><span>メモ（任意）</span><textarea data-control-id={`calendar.event.note.${formId}`} className="textarea" maxLength={2000} value={draft.note} onChange={(event) => patch({ note: event.target.value })}/></label>
    <fieldset className="fieldset"><legend>参加者</legend><div className="choice-grid">{people.map((member) => <label key={member.id}><input data-control-id={`calendar.event.participant.${formId}.${member.id}`} type="checkbox" checked={draft.participantIds.includes(member.id)} onChange={(event) => patch({ participantIds: toggle(draft.participantIds, member.id, event.target.checked) })}/>{member.displayName}</label>)}</div></fieldset>
    <div className="field">
      <label htmlFor={`event-audience-${formId}`}>公開範囲</label>
      <select data-control-id={`calendar.event.audience.${formId}`} className="select" id={`event-audience-${formId}`} aria-describedby={`event-audience-help-${formId}`} value={draft.audience} onChange={(event) => patch({ audience: event.target.value as VisibilityAudience })}>{audiences.map((audience) => <option key={audience} value={audience}>{ja.visibility[audience]}</option>)}</select>
      <span className="field-help" id={`event-audience-help-${formId}`}>{ja.visibilityHelp[draft.audience]}</span>
    </div>
    {draft.audience === 'selected' && <fieldset className="fieldset"><legend>公開するメンバー（{MAX_SELECTED_MEMBERS}人まで）</legend><div className="choice-grid">{people.map((member) => {
      const checked = draft.selectedIds.includes(member.id);
      return <label key={member.id}><input data-control-id={`calendar.event.selected-member.${formId}.${member.id}`} type="checkbox" checked={checked} disabled={!checked && draft.selectedIds.length >= MAX_SELECTED_MEMBERS} onChange={(event) => patch({ selectedIds: toggle(draft.selectedIds, member.id, event.target.checked) })}/>{member.displayName}</label>;
    })}</div></fieldset>}
    {recurrenceNote ? <p className="small muted mb-0">{recurrenceNote}</p> : <>
      <div className="field">
        <label htmlFor={`event-recurrence-${formId}`}>繰り返し</label>
        <select data-control-id={`calendar.event.recurrence.${formId}`} className="select" id={`event-recurrence-${formId}`} value={draft.recurrence} onChange={(event) => patch({ recurrence: event.target.value as RecurrenceChoice })}>
          {recurrenceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          {initial.recurrence === 'keep' && <option value="keep">今の設定のまま（{keptRuleLabel}）</option>}
        </select>
        {draft.recurrence === 'month-end' && <span className="field-help">31日がない月は、その月の最後の日に入ります。最初の回は開始日以降の月末です。</span>}
        {draft.recurrence === 'monthly' && Number(draft.start.slice(8, 10)) > 28 && <span className="field-help">その日がない月には入りません。月の最後の日に入れるときは「毎月の末日」を選びます。</span>}
      </div>
      {draft.recurrence === 'every-n-days' && <label className="field"><span>何日ごと</span><input data-control-id={`calendar.event.interval.${formId}`} className="input" type="number" min={1} max={366} step={1} value={draft.intervalDays} onChange={(event) => patch({ intervalDays: Number(event.target.value) })}/></label>}
      {draft.recurrence !== 'none' && draft.recurrence !== 'keep' && <label className="field"><span>繰り返しの終了日（任意）</span><input data-control-id={`calendar.event.until.${formId}`} className="input" type="date" value={draft.until} onChange={(event) => patch({ until: event.target.value })}/></label>}
    </>}
    {snapshot.colorLabels.length > 0 && <fieldset className="fieldset"><legend>リスト</legend><div className="choice-grid">
      <label><input data-control-id={`calendar.event.color.${formId}.none`} type="radio" name={`event-color-${formId}`} checked={!draft.colorLabelId} onChange={() => patch({ colorLabelId: '' })}/>なし</label>
      {snapshot.colorLabels.map((label) => <label key={label.id}><input data-control-id={`calendar.event.color.${formId}.${label.id}`} type="radio" name={`event-color-${formId}`} checked={draft.colorLabelId === label.id} onChange={() => patch({ colorLabelId: label.id })}/><span className="color-dot" style={labelStyle(snapshot.colorLabels, label.id)} aria-hidden="true"/>{label.name}</label>)}
    </div></fieldset>}
    <label className="field"><span>通知</span><select data-control-id={`calendar.event.reminder.${formId}`} className="select" value={draft.reminderMinutes ?? ''} onChange={(event) => patch({ reminderMinutes: event.target.value === '' ? null : Number(event.target.value) })}>
      <option value="">通知しない</option>
      {[...reminderChoices, ...(draft.reminderMinutes !== null && !(reminderChoices as readonly number[]).includes(draft.reminderMinutes) ? [draft.reminderMinutes] : [])].map((minutes) => <option key={minutes} value={minutes}>{reminderLabel(minutes)}</option>)}
    </select></label>
    <label className="check-row"><input data-control-id={`calendar.event.weather-sensitive.${formId}`} type="checkbox" checked={draft.weatherSensitive} onChange={(event) => patch({ weatherSensitive: event.target.checked })}/>天気の影響を表示する</label>
    {shown && <p className="field-error" role="alert">{shown}</p>}
    <div className="dialog-actions">
      <button data-control-id={`calendar.event.form-cancel.${formId}`} className="button" type="button" disabled={busy} onClick={onCancel}>{ja.actions.cancel}</button>
      <button data-control-id={`calendar.event.form-save.${formId}`} className="button primary" type="submit" disabled={busy}>{busy ? ja.actions.saving : submitLabel}</button>
    </div>
  </form>;
}
