import { useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { detailId } from '../../app/router';
import { canDeleteResource, canMutateOwnedResource } from '../../authz/policy';
import { ja, recurrenceLabel, taskActionLabel, taskStatusLabels } from '../../content/ja';
import { Dialog, StatusBadge } from '../../design-system/components';
import { DetailSurface } from '../../design-system/DetailSurface';
import { CheckIcon, LockIcon, PeopleIcon } from '../../design-system/icons';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { describeRule } from '../../domain/recurrence';
import { taskDraftToUpdateInput, todoToDraft, type TaskDraft } from '../../domain/taskForm';
import { todoFlowFor, type TodoAction } from '../../domain/todoFlow';
import type { RecurrenceScope, Todo } from '../../domain/types';
import { labelStyle } from '../calendar/calendarLabels';
import { audienceText } from '../shared/visibilityText';
import { TaskForm } from './TaskForm';
import { dueText } from './taskLabels';
import { useTodoTransition } from './useTodoTransition';

/** 繰り返しのタスクで選べる範囲。表示されているのは次の1回だけなので「今回だけ」と「すべて（今回以降）」の2つ。 */
const taskScopes: RecurrenceScope[] = ['this', 'series'];
const NOTE_MAX = 500;

interface Props {
  todo: Todo;
  onClose: () => void;
  onDeleted: (todo: Todo) => void;
}

/** 状態を変える操作と、一緒に残す一言。 */
function TaskActions({ todo, scopeControl, onDone }: { todo: Todo; scopeControl?: React.ReactNode; onDone: () => void }) {
  const { snapshot } = useApp();
  const transition = useTodoTransition();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const flow = todoFlowFor(todo, snapshot.viewer);
  if (!flow.suggested && !flow.others.length) return scopeControl;
  const run = async (action: TodoAction) => {
    setBusy(true);
    const done = await transition(todo, action, note);
    setBusy(false);
    if (done) onDone();
  };
  const actionButton = (action: TodoAction, primary: boolean) => <button key={action} data-control-id={`tasks.action.${action}.${todo.id}`} className={primary ? 'button primary full' : 'button'} type="button" disabled={busy} onClick={() => void run(action)}>{primary && <CheckIcon width="18"/>}{taskActionLabel(action, todo.status)}</button>;
  return <section className="card flat stack" aria-labelledby="task-next-action">
    <h3 id="task-next-action">次の操作</h3>
    {flow.awaitingReviewer && todo.reviewerMembershipId && <p className="small muted mb-0">{memberName(snapshot, todo.reviewerMembershipId)}さんの確認を待っています。</p>}
    {scopeControl}
    <label className="field"><span>一言（任意）</span><input data-control-id={`tasks.status-note.${todo.id}`} className="input" maxLength={NOTE_MAX} value={note} aria-describedby="task-status-note-help" onChange={(event) => setNote(event.target.value)}/><span className="field-help" id="task-status-note-help">状態を変えるときに、次の人への一言として残します。完了のときは完了の一言になります。</span></label>
    {flow.suggested && actionButton(flow.suggested, true)}
    {flow.others.length > 0 && <div className="task-other-actions">{flow.others.map((action) => actionButton(action, false))}</div>}
  </section>;
}

export function TaskDrawer({ todo, onClose, onDeleted }: Props) {
  const { snapshot, gateway, refresh, announce, executeQueueable } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scope, setScope] = useState<RecurrenceScope>('this');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { viewer, colorLabels } = snapshot;
  const canEdit = canMutateOwnedResource(viewer, 'task.update', todo.creatorMembershipId).allowed;
  const canDelete = canDeleteResource(viewer, 'task.delete', [todo.creatorMembershipId, todo.assigneeMembershipId]).allowed;
  const recurrenceEditable = !todo.recurrence || scope !== 'this';
  const rule = todo.recurrence && todo.dueAt ? describeRule(dateKeyFromRfc3339(todo.dueAt), todo.recurrence) : undefined;
  const label = colorLabels.find((item) => item.id === todo.colorLabelId);
  const closeForm = () => { if (!submitting) { setEditing(false); setFormError(''); } };
  // 横に並べて開いているときは、待っている間に別のタスクへ移れる。移った先を閉じない。
  const closeIfShown = () => { if (detailId(window.location.pathname, '/tasks') === todo.id) onClose(); };

  const update = async (draft: TaskDraft) => {
    if (submitting) return;
    setFormError(''); setSubmitting(true);
    const input = taskDraftToUpdateInput(draft, todo, { recurrenceEditable });
    const outcome = await executeQueueable({ operation: 'task.update', summary: `タスク「${todo.title}」を変更`, payload: { id: todo.id, scope, input, expectedVersion: todo.version } }, () => gateway.todos.updateTodo(todo.id, scope, input, todo.version));
    setSubmitting(false);
    if (outcome.status === 'failed') { setFormError(outcome.error.message); return; }
    if (outcome.status === 'queued') { setEditing(false); return; }
    await refresh(); setEditing(false); announce(`「${outcome.value.title}」を更新しました`);
  };
  const remove = async () => {
    const result = await gateway.todos.deleteTodo(todo.id, todo.version, todo.recurrence ? scope : 'series');
    if (!result.ok) return announce(result.error.message);
    onDeleted(todo); setDeleting(false); onClose();
    await refresh();
    announce(`「${todo.title}」${todo.recurrence && scope === 'this' ? 'の今回分' : ''}を削除しました`);
  };

  const scopeControl = todo.recurrence && <label className="field"><span>対象とするタスク</span><select data-control-id={`tasks.recurrence-scope.${todo.id}`} className="select" value={scope} onChange={(event) => setScope(event.target.value as RecurrenceScope)}>{taskScopes.map((value) => <option key={value} value={value}>{recurrenceLabel('task', value)}</option>)}</select></label>;
  return <>
    <DetailSurface eyebrow="タスクの内容" title={todo.title} onClose={onClose}><div className="stack">
      <div className="grid two">
        <div className="card flat"><span className="meta">状態</span><p className="task-state"><StatusBadge tone={todo.status === 'review' ? 'attention' : todo.status === 'done' ? 'success' : 'neutral'}>{taskStatusLabels[todo.status]}</StatusBadge>{todo.priority && todo.priority !== 'normal' && <StatusBadge tone={todo.priority === 'high' ? 'attention' : 'neutral'}>優先度：{ja.taskPriority[todo.priority]}</StatusBadge>}</p></div>
        <div className="card flat"><span className="meta">期限</span><p><strong className="task-due">{dueText(todo, snapshot.context.asOf)}</strong></p>{rule && <p className="small muted mb-0">{rule}</p>}</div>
      </div>
      <div className="card flat"><h3><PeopleIcon width="18"/> 担当する人と確認する人</h3><dl>
        <dt className="meta">担当する人</dt><dd>{memberName(snapshot, todo.assigneeMembershipId)}</dd>
        <dt className="meta">確認する人</dt><dd>{todo.reviewerMembershipId ? memberName(snapshot, todo.reviewerMembershipId) : 'なし'}</dd>
        <dt className="meta">作成した人</dt><dd>{memberName(snapshot, todo.creatorMembershipId)}</dd>
      </dl></div>
      {todo.note && <div><h3>メモ</h3><p>{todo.note}</p></div>}
      {todo.handoffNote && <div><h3>引き継ぎの一言</h3><p>{todo.handoffNote}</p></div>}
      {todo.completionNote && <div><h3>完了の一言</h3><p>{todo.completionNote}</p></div>}
      <p className="small muted mb-0 task-sharing"><LockIcon width="14" aria-hidden="true"/> 公開範囲：{audienceText('task', todo.visibility, (id) => memberName(snapshot, id))}{label && <span className="person-chip task-label"><span className="color-dot" style={labelStyle(colorLabels, label.id)} aria-hidden="true"/>{label.name}</span>}</p>
      <TaskActions todo={todo} scopeControl={scopeControl} onDone={closeIfShown}/>
      {canEdit && <button data-control-id={`tasks.edit.open.${todo.id}`} className="button full" type="button" onClick={() => setEditing(true)}>内容を編集</button>}
      {canDelete && <button data-control-id={`tasks.delete.open.${todo.id}`} className="button danger full" type="button" onClick={() => setDeleting(true)}>タスクを削除</button>}
    </div></DetailSurface>
    {editing && <Dialog title="タスクを編集" description={todo.recurrence ? `変更する範囲：${recurrenceLabel('task', scope)}` : undefined} onClose={closeForm}>
      <TaskForm formId={todo.id} initial={todoToDraft(todo)} creatorId={todo.visibility.creatorMembershipId} submitLabel={ja.actions.saveChanges} busy={submitting} error={formError} recurrenceNote={recurrenceEditable ? undefined : '繰り返しを変えるときは、対象を「すべてのタスク」にしてください。'} keptRuleLabel={rule} onSubmit={(draft) => void update(draft)} onCancel={closeForm}/>
    </Dialog>}
    {deleting && <Dialog title="タスクを削除しますか" description={`「${todo.title}」${todo.recurrence ? `（${recurrenceLabel('task', scope)}）` : ''}を削除します。`} onClose={() => setDeleting(false)} actions={<>
      <button data-control-id={`tasks.delete.cancel.${todo.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button>
      <button data-control-id={`tasks.delete.confirm.${todo.id}`} className="button danger" type="button" onClick={() => void remove()}>{ja.actions.delete}</button>
    </>}><p className="muted">削除すると、共有相手の画面にも表示されなくなります。7日以内なら元に戻せます。</p></Dialog>}
  </>;
}
