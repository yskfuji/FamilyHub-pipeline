import { useState, type FormEvent, type ReactNode } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { AlertIcon } from '../../design-system/icons';
import { assignablePeople, peopleOutsideVisibility, taskDraftProblem, type TaskDraft } from '../../domain/taskForm';
import type { TodoPriority } from '../../domain/types';
import { ColorLabelFields } from '../shared/ColorLabelFields';
import { RecurrenceFields } from '../shared/RecurrenceFields';
import { VisibilityFields } from '../shared/VisibilityFields';

const priorities: readonly TodoPriority[] = ['low', 'normal', 'high'];

interface Props {
  /** 操作の ID の末尾に使う。新規は new。 */
  formId: string;
  initial: TaskDraft;
  /** 編集のときの、作った人。新規なら見ている人。 */
  creatorId?: string;
  submitLabel: string;
  busy: boolean;
  error: string;
  /** 繰り返しを変えられないときの説明。 */
  recurrenceNote?: ReactNode;
  /** 今の規則がこの画面で作れないときの表示名。 */
  keptRuleLabel?: string;
  onSubmit: (draft: TaskDraft) => void;
  onCancel: () => void;
}

export function TaskForm({ formId, initial, creatorId, submitLabel, busy, error, recurrenceNote, keptRuleLabel, onSubmit, onCancel }: Props) {
  const { snapshot } = useApp();
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState('');
  const patch = (changes: Partial<TaskDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const assignable = assignablePeople(snapshot.memberships, [initial.assigneeId, initial.reviewerId]);
  const selectable = snapshot.memberships.filter((member) => member.status === 'active' || draft.selectedIds.includes(member.id));
  const outside = peopleOutsideVisibility(draft, snapshot.memberships, creatorId ?? snapshot.viewer.membershipId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = taskDraftProblem(draft, !recurrenceNote);
    setProblem(found ?? '');
    if (!found) onSubmit(draft);
  };
  const shown = problem || error;
  const formKey = `task-${formId}`;
  return <form className="stack" aria-busy={busy} noValidate onSubmit={submit}>
    <label className="field"><span>タスク名</span><input data-control-id={`tasks.form.title.${formId}`} className="input" name="title" autoFocus required maxLength={120} placeholder="例：提出物を確認する" value={draft.title} onChange={(event) => patch({ title: event.target.value })}/></label>
    <label className="field"><span>メモ（任意）</span><textarea data-control-id={`tasks.form.note.${formId}`} className="textarea" maxLength={2000} value={draft.note} onChange={(event) => patch({ note: event.target.value })}/></label>
    <div className="grid two">
      <label className="field"><span>開始（任意）</span><input data-control-id={`tasks.form.starts-at.${formId}`} className="input" type="datetime-local" value={draft.start} onChange={(event) => patch({ start: event.target.value })}/></label>
      <label className="field"><span>期限（任意）</span><input data-control-id={`tasks.form.due-at.${formId}`} className="input" type="datetime-local" value={draft.end} onChange={(event) => patch({ end: event.target.value })}/></label>
    </div>
    <div className="grid two">
      <label className="field"><span>担当者</span><select data-control-id={`tasks.form.assignee.${formId}`} className="select" value={draft.assigneeId} onChange={(event) => patch({ assigneeId: event.target.value })}>{assignable.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
      <label className="field"><span>確認する人（任意）</span><select data-control-id={`tasks.form.reviewer.${formId}`} className="select" value={draft.reviewerId} onChange={(event) => patch({ reviewerId: event.target.value })}><option value="">なし</option>{assignable.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
    </div>
    <label className="field"><span>優先度</span><select data-control-id={`tasks.form.priority.${formId}`} className="select" value={draft.priority} onChange={(event) => patch({ priority: event.target.value as TodoPriority })}>{priorities.map((priority) => <option key={priority} value={priority}>{ja.taskPriority[priority]}</option>)}</select></label>
    <VisibilityFields kind="task" formId={formId} audience={draft.audience} selectedIds={draft.selectedIds} initialAudience={initial.audience} people={selectable} onChange={patch}/>
    {outside.length > 0 && <div className="callout" role="status"><AlertIcon/><p className="small mb-0">{outside.map((member) => member.displayName).join('、')}さんには、この公開範囲だとタスクが表示されません。</p></div>}
    {recurrenceNote ? <p className="small muted mb-0">{recurrenceNote}</p> : <RecurrenceFields formKey={formKey} value={draft} startDate={draft.end} keptRuleLabel={initial.recurrence === 'keep' ? keptRuleLabel ?? '' : undefined} onChange={patch}/>}
    <ColorLabelFields formKey={formKey} value={draft.colorLabelId} onChange={(colorLabelId) => patch({ colorLabelId })}/>
    {shown && <p className="field-error" role="alert">{shown}</p>}
    <div className="dialog-actions">
      <button data-control-id={`tasks.form.cancel.${formId}`} className="button" type="button" disabled={busy} onClick={onCancel}>{ja.actions.cancel}</button>
      <button data-control-id={`tasks.form.submit.${formId}`} className="button primary" type="submit" disabled={busy}>{busy ? ja.actions.saving : submitLabel}</button>
    </div>
  </form>;
}
