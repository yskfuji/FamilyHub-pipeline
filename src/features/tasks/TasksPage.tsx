import { useMemo, useState } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { detailId, useCloseTo } from '../../app/router';
import type { TodoStatus } from '../../domain/types';
import { Drawer, EmptyState, PageHeader, StatusBadge, formatTime } from '../../design-system/components';
import { CheckIcon, ClockIcon, PeopleIcon } from '../../design-system/icons';

const columns: Array<{ status: TodoStatus; label: string }> = [{ status: 'open', label: '未着手' }, { status: 'doing', label: '進行中' }, { status: 'review', label: '確認待ち' }, { status: 'done', label: '完了' }];
const nextStatus: Record<TodoStatus, TodoStatus> = { open: 'doing', doing: 'review', review: 'done', done: 'open' };
const nextLabel: Record<TodoStatus, string> = { open: '着手する', doing: '確認を依頼', review: '完了にする', done: '未着手に戻す' };

export function TasksPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [filter, setFilter] = useState<'all'|'mine'|'review'>('all');
  const activeId = detailId(path, '/tasks');
  const active = snapshot.todos.find((todo) => todo.id === activeId);
  const close = useCloseTo('/tasks');
  const todos = useMemo(() => snapshot.todos.filter((todo) => filter === 'all' || (filter === 'mine' ? todo.assigneeMembershipId === 'member-aoi' : todo.reviewerMembershipId === 'member-aoi' && todo.status === 'review')), [snapshot.todos, filter]);
  const advance = async () => {
    if (!active) return;
    const result = await gateway.todos.updateTodoStatus(active.id, nextStatus[active.status], active.version);
    if (!result.ok) { announce(result.error.message); return; }
    await refresh(); announce(`「${active.title}」を${nextLabel[active.status]}に更新しました`); close();
  };
  return <div className="page"><PageHeader eyebrow="Tasks" title="家族のTodo" description="担当する人、確認する人、作った人を分けて、見えない段取りを見える形に。" action={<button className="button primary" type="button" onClick={() => document.querySelector<HTMLButtonElement>('.quick-create')?.click()}>Todoを追加</button>}/><div className="section-head"><div className="segmented" aria-label="Todoの絞り込み">{([['all','すべて'],['mine','自分の担当'],['review','自分の確認']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="meta">{todos.length}件</span></div>{todos.length === 0 ? <EmptyState title="該当するTodoはありません">別の絞り込みを選ぶか、新しいTodoを追加できます。</EmptyState> : <div className="task-board">{columns.map((column) => <section className="task-column" key={column.status} aria-labelledby={`column-${column.status}`}><div className="section-head"><h2 id={`column-${column.status}`}>{column.label}</h2><StatusBadge>{todos.filter((todo) => todo.status === column.status).length}</StatusBadge></div>{todos.filter((todo) => todo.status === column.status).map((todo) => <a className="task-card" href={`/tasks/${todo.id}`} data-link key={todo.id}><strong>{todo.title}</strong><span className="meta"><ClockIcon width="14"/> {formatTime(todo.dueAt)}</span><span className="people"><span className="person-chip">担当 {memberName(snapshot,todo.assigneeMembershipId)}</span>{todo.reviewerMembershipId && <span className="person-chip">確認 {memberName(snapshot,todo.reviewerMembershipId)}</span>}</span>{todo.recurrence && <StatusBadge>毎週</StatusBadge>}</a>)}</section>)}</div>}
    {active && <Drawer eyebrow="Todo detail" title={active.title} onClose={close}><div className="stack"><div className="grid two"><div className="card flat"><span className="meta">状態</span><p><StatusBadge tone={active.status === 'review' ? 'attention' : active.status === 'done' ? 'success' : 'neutral'}>{columns.find((column) => column.status === active.status)?.label}</StatusBadge></p></div><div className="card flat"><span className="meta">期限</span><p><strong>{formatTime(active.dueAt)}</strong></p></div></div><div className="card flat"><h3><PeopleIcon width="18"/> 役割</h3><dl><dt className="meta">担当者</dt><dd>{memberName(snapshot,active.assigneeMembershipId)}</dd><dt className="meta">レビュアー</dt><dd>{memberName(snapshot,active.reviewerMembershipId)}</dd><dt className="meta">作成者</dt><dd>{memberName(snapshot,active.creatorMembershipId)}</dd></dl></div>{active.note && <div><h3>メモ</h3><p>{active.note}</p></div>}{active.recurrence && <label className="field"><span>繰り返しを編集する範囲</span><select className="select"><option>今回のみ</option><option>今回以降</option><option>系列全体</option></select></label>}<button className="button primary full" type="button" onClick={() => void advance()}><CheckIcon width="18"/>{nextLabel[active.status]}</button><button className="button full" type="button">内容を編集</button></div></Drawer>}
  </div>;
}
