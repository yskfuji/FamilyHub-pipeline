import { useMemo, useState } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { detailId, useCloseTo } from '../../app/router';
import type { RecurrenceScope, Todo, TodoStatus } from '../../domain/types';
import { DetailNotFound, Dialog, Drawer, EmptyState, PageHeader, StatusBadge, formatDue } from '../../design-system/components';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { describeRule } from '../../domain/recurrence';
import { CheckIcon, ClockIcon, PeopleIcon } from '../../design-system/icons';
import { ja, recurrenceLabel, taskStatusLabels } from '../../content/ja';

const columns: Array<{ status: TodoStatus; label: string }> = (Object.keys(taskStatusLabels) as TodoStatus[]).map((status) => ({ status, label: taskStatusLabels[status] }));
const nextStatus: Record<TodoStatus, TodoStatus> = { open: 'doing', doing: 'review', review: 'done', done: 'open' };
const nextLabel: Record<TodoStatus, string> = { open: '着手する', doing: '確認を依頼する', review: '完了にする', done: '未着手に戻す' };
const statusChangeMessage: Record<TodoStatus, string> = { open: '進行中にしました', doing: '確認を依頼しました', review: '完了にしました', done: '未着手に戻しました' };
// 確認する人がいないタスクは「確認を依頼する」を飛ばして完了にする（依頼先がないまま確認待ちにしない）。
const transitionOf = (todo: Todo): { status: TodoStatus; label: string; message: string } => (todo.status === 'doing' && !todo.reviewerMembershipId
  ? { status: 'done', label: '完了にする', message: '完了にしました' }
  : { status: nextStatus[todo.status], label: nextLabel[todo.status], message: statusChangeMessage[todo.status] });
/** 繰り返しのタスクで選べる範囲。表示されているのは次の1回だけなので「今回だけ」と「すべて（今回以降）」の2つ。 */
const taskScopes: RecurrenceScope[] = ['this', 'series'];
const reviewerName = (snapshot: Parameters<typeof memberName>[0], id?: string) => (id ? memberName(snapshot, id) : 'なし');

export function TasksPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce, can, requestQuickCreate, executeQueueable } = useApp();
  const [filter, setFilter] = useState<'all'|'mine'|'review'>('all');
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<RecurrenceScope>('this');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState<Todo | null>(null);
  const activeId = detailId(path, '/tasks');
  const active = snapshot.todos.find((todo) => todo.id === activeId);
  const close = useCloseTo('/tasks');
  const todos = useMemo(() => snapshot.todos.filter((todo) => filter === 'all' || (filter === 'mine' ? todo.assigneeMembershipId === snapshot.viewer.membershipId : todo.reviewerMembershipId === snapshot.viewer.membershipId && todo.status === 'review')), [snapshot.todos, snapshot.viewer.membershipId, filter]);
  const advance = async () => {
    if (!active) return;
    const transition = transitionOf(active);
    const result = await gateway.todos.updateTodoStatus(active.id, transition.status, active.version);
    if (!result.ok) { announce(result.error.message); return; }
    close(); await refresh(); announce(`「${active.title}」を${transition.message}${active.recurrence && transition.status === 'done' ? '。次の回を作成しました' : ''}`);
  };
  const update = async (todo: Todo, form: HTMLFormElement) => {
    if (submitting) return; setFormError(''); setSubmitting(true);
    const values = new FormData(form);
    const due = String(values.get('dueAt') ?? '');
    const reviewer = String(values.get('reviewerMembershipId') ?? '');
    const input = {
      title: String(values.get('title') ?? '').trim(), dueAt: due ? `${due}:00+09:00` : undefined,
      assigneeMembershipId: String(values.get('assigneeMembershipId')), reviewerMembershipId: reviewer || undefined,
      note: String(values.get('note') ?? '').trim() || undefined,
    };
    const outcome = await executeQueueable({ operation: 'task.update', summary: `タスク「${todo.title}」を変更`, payload: { id: todo.id, scope, input, expectedVersion: todo.version } }, () => gateway.todos.updateTodo(todo.id, scope, input, todo.version));
    setSubmitting(false);
    if (outcome.status === 'failed') { setFormError(outcome.error.message); return; }
    if (outcome.status === 'queued') { setEditing(false); return; }
    await refresh(); setEditing(false); announce(`「${outcome.value.title}」を更新しました`);
  };
  const canEdit = active && can('task.update') && (['owner','adult'].includes(snapshot.viewer.role) || active.creatorMembershipId === snapshot.viewer.membershipId);
  const canTransition = active && can('task.transition') && (['owner','adult'].includes(snapshot.viewer.role) || [active.creatorMembershipId, active.assigneeMembershipId, active.reviewerMembershipId].includes(snapshot.viewer.membershipId));
  const canDelete = active && can('task.delete') && (['owner','adult'].includes(snapshot.viewer.role) || active.creatorMembershipId === snapshot.viewer.membershipId);
  const remove = async () => { if (!active) return; const result = await gateway.todos.deleteTodo(active.id, active.version, active.recurrence ? scope : 'series'); if (!result.ok) return announce(result.error.message); setDeleted(active); setDeleting(false); close(); await refresh(); announce(`「${active.title}」${active.recurrence && scope === 'this' ? 'の今回分' : ''}を削除しました`); };
  const restore = async () => { if (!deleted) return; const result = await gateway.todos.restoreTodo(deleted.id); if (!result.ok) return announce(result.error.message); setDeleted(null); await refresh(); announce(`「${result.value.title}」を元に戻しました`); };
  return <div className="page"><PageHeader eyebrow="タスク" title="家族のタスク" description="担当する人と確認する人を分けて管理できます。" action={can('task.create') ? <button data-control-id="tasks.create.open" className="button primary" type="button" onClick={() => requestQuickCreate('todo')}>タスクを追加</button> : undefined}/>{deleted && <div className="callout info" role="status"><CheckIcon/><div><strong>「{deleted.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id="tasks.restore" className="button" type="button" onClick={() => void restore()}>{ja.actions.restore}</button></div>}{activeId && !active && <DetailNotFound what="タスク" feature="tasks" backHref="/tasks"/>}<div className="section-head filter-head"><div className="segmented" role="group" aria-label="タスクの絞り込み">{([['all','すべて'],['mine','自分の担当'],['review','確認を頼まれた']] as const).map(([value,label]) => <button data-control-id={`tasks.filter.${value}`} key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="meta">{todos.length}件</span></div>{todos.length === 0 ? <EmptyState title="該当するタスクはありません">別の条件を選ぶか、タスクを追加してください。</EmptyState> : <div className="task-board">{columns.map((column) => <section className="task-column" key={column.status} aria-labelledby={`column-${column.status}`}><div className="section-head"><h2 id={`column-${column.status}`}>{column.label}</h2><StatusBadge>{todos.filter((todo) => todo.status === column.status).length}</StatusBadge></div>{todos.filter((todo) => todo.status === column.status).map((todo) => <a data-control-id={`tasks.open.${todo.id}`} className="task-card" href={`/tasks/${todo.id}`} data-link key={todo.id}><strong>{todo.title}</strong><span className="meta"><ClockIcon width="14"/> {formatDue(todo.dueAt, snapshot.context.asOf)}</span><span className="people"><span className="person-chip">担当：{memberName(snapshot,todo.assigneeMembershipId)}</span>{todo.reviewerMembershipId && <span className="person-chip">確認する人：{memberName(snapshot,todo.reviewerMembershipId)}</span>}</span>{todo.recurrence && todo.dueAt && <StatusBadge>{describeRule(dateKeyFromRfc3339(todo.dueAt), todo.recurrence)}</StatusBadge>}</a>)}</section>)}</div>}
    {active && <Drawer eyebrow="タスクの内容" title={active.title} onClose={close}><div className="stack"><div className="grid two"><div className="card flat"><span className="meta">状態</span><p><StatusBadge tone={active.status === 'review' ? 'attention' : active.status === 'done' ? 'success' : 'neutral'}>{taskStatusLabels[active.status]}</StatusBadge></p></div><div className="card flat"><span className="meta">期限</span><p><strong>{formatDue(active.dueAt, snapshot.context.asOf)}</strong></p>{active.recurrence && active.dueAt && <p className="small muted mb-0">{describeRule(dateKeyFromRfc3339(active.dueAt), active.recurrence)}</p>}</div></div><div className="card flat"><h3><PeopleIcon width="18"/> 担当する人と確認する人</h3><dl><dt className="meta">担当する人</dt><dd>{memberName(snapshot,active.assigneeMembershipId)}</dd><dt className="meta">確認する人</dt><dd>{reviewerName(snapshot, active.reviewerMembershipId)}</dd><dt className="meta">作成した人</dt><dd>{memberName(snapshot,active.creatorMembershipId)}</dd></dl></div>{active.note && <div><h3>メモ</h3><p>{active.note}</p></div>}{active.recurrence && <label className="field"><span>対象とするタスク</span><select data-control-id={`tasks.recurrence-scope.${active.id}`} className="select" value={scope} onChange={(event) => setScope(event.target.value as RecurrenceScope)}>{taskScopes.map((value) => <option key={value} value={value}>{recurrenceLabel('task', value)}</option>)}</select></label>}{canTransition && <button data-control-id={`tasks.advance.${active.id}`} className="button primary full" type="button" onClick={() => void advance()}><CheckIcon width="18"/>{transitionOf(active).label}</button>}{canEdit && <button data-control-id={`tasks.edit.open.${active.id}`} className="button full" type="button" onClick={() => setEditing(true)}>内容を編集</button>}{canDelete && <button data-control-id={`tasks.delete.open.${active.id}`} className="button danger full" type="button" onClick={() => setDeleting(true)}>タスクを削除</button>}</div></Drawer>}
    {active && editing && <Dialog title="タスクを編集" description={active.recurrence ? `変更する範囲：${recurrenceLabel('task', scope)}` : undefined} onClose={() => { if (!submitting) { setEditing(false); setFormError(''); } }}><form className="stack" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void update(active, event.currentTarget); }}><label className="field"><span>タスク名</span><input data-control-id={`tasks.edit.title.${active.id}`} className="input" name="title" required maxLength={120} defaultValue={active.title}/></label><label className="field"><span>期限</span><input data-control-id={`tasks.edit.due-at.${active.id}`} className="input" name="dueAt" type="datetime-local" defaultValue={active.dueAt?.slice(0,16)}/></label><div className="grid two"><label className="field"><span>担当者</span><select data-control-id={`tasks.edit.assignee.${active.id}`} className="select" name="assigneeMembershipId" defaultValue={active.assigneeMembershipId}>{snapshot.memberships.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}</select></label><label className="field"><span>確認する人</span><select data-control-id={`tasks.edit.reviewer.${active.id}`} className="select" name="reviewerMembershipId" defaultValue={active.reviewerMembershipId ?? ''}><option value="">なし</option>{snapshot.memberships.map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}</select></label></div><label className="field"><span>メモ</span><textarea data-control-id={`tasks.edit.note.${active.id}`} className="textarea" name="note" maxLength={2000} defaultValue={active.note}/></label>{formError && <p className="field-error" role="alert">{formError}</p>}<div className="dialog-actions"><button data-control-id={`tasks.edit.cancel.${active.id}`} className="button" type="button" disabled={submitting} onClick={() => setEditing(false)}>{ja.actions.cancel}</button><button data-control-id={`tasks.edit.submit.${active.id}`} className="button primary" type="submit" disabled={submitting}>{submitting ? ja.actions.saving : ja.actions.saveChanges}</button></div></form></Dialog>}
    {active && deleting && <Dialog title="タスクを削除しますか" description={`「${active.title}」${active.recurrence ? `（${recurrenceLabel('task', scope)}）` : ''}を削除します。`} onClose={() => setDeleting(false)} actions={<><button data-control-id={`tasks.delete.cancel.${active.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button><button data-control-id={`tasks.delete.confirm.${active.id}`} className="button danger" type="button" onClick={() => void remove()}>{ja.actions.delete}</button></>}><p className="muted">削除すると、共有相手の画面にも表示されなくなります。7日以内なら元に戻せます。</p></Dialog>}
  </div>;
}
