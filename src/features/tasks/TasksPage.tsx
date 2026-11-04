import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { detailId, navigate, useSearch, withQueryParam } from '../../app/router';
import { ja, taskStatusLabels } from '../../content/ja';
import { DetailNotFound, EmptyState, PageHeader, StatusBadge } from '../../design-system/components';
import { useContentWide } from '../../design-system/DetailSurface';
import { CheckIcon } from '../../design-system/icons';
import { EmptyDone } from '../../design-system/illustrations/EmptyDone';
import { EmptyTasks } from '../../design-system/illustrations/EmptyTasks';
import { filterTasks, parseTaskFilter, taskColumns, taskCounts, taskFilters, type TaskFilter } from '../../domain/taskList';
import type { Todo } from '../../domain/types';
import { MemberScopeSelect, ScopeNote } from '../shared/MemberScopeSelect';
import { TaskCard } from './TaskCard';
import { TaskDrawer } from './TaskDrawer';

export function TasksPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce, can, requestQuickCreate } = useApp();
  const [deleted, setDeleted] = useState<Todo | null>(null);
  const search = useSearch();
  const filter = parseTaskFilter(new URLSearchParams(search).get('filter'));
  const viewerId = snapshot.viewer.membershipId;
  const activeId = detailId(path, '/tasks');
  const active = snapshot.todos.find((todo) => todo.id === activeId);
  const { todos: scoped, memberId } = useMemberScope();
  const wide = useContentWide();
  const todos = useMemo(() => filterTasks(scoped, filter, viewerId), [scoped, filter, viewerId]);
  const counts = useMemo(() => taskCounts(scoped, viewerId), [scoped, viewerId]);
  const columns = taskColumns(filter);
  const restore = async () => {
    if (!deleted) return;
    const result = await gateway.todos.restoreTodo(deleted.id);
    if (!result.ok) return announce(result.error.message);
    setDeleted(null);
    await refresh();
    announce(`「${result.value.title}」を元に戻しました`);
  };
  return <div className="page">
    <PageHeader eyebrow="タスク" title="家族のタスク" description="担当する人と確認する人を分けて管理できます。" action={<div className="page-head-actions"><MemberScopeSelect/>{can('task.create') && <button data-control-id="tasks.create.open" className="button primary" type="button" onClick={() => requestQuickCreate('todo')}>タスクを追加</button>}</div>}/>
    {deleted && <div className="callout info" role="status"><CheckIcon/><div><strong>「{deleted.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id="tasks.restore" className="button" type="button" onClick={() => void restore()}>{ja.actions.restore}</button></div>}
    {activeId && !active && <DetailNotFound what="タスク" feature="tasks" backHref={`/tasks${search}`}/>}
    <div className="detail-layout" data-pane={wide && active ? 'open' : undefined}><div className="detail-main">
    <div className="section-head filter-head">
      <div className="segmented" role="group" aria-label="タスクの絞り込み">{taskFilters.map((value) => <button data-control-id={`tasks.filter.${value}`} key={value} type="button" aria-pressed={filter === value} onClick={() => navigate(withQueryParam('filter', value === 'open' ? null : value), true, true)}>{ja.taskFilter[value]} {counts[value]}</button>)}</div>
      <span className="meta">{todos.length}件</span>
    </div>
    {todos.length === 0
      ? <TasksEmpty filter={filter} total={scoped.length} allDone={filter === 'open' ? counts.done > 0 : filter === 'mine' && scoped.some((todo) => todo.status === 'done' && todo.assigneeMembershipId === viewerId)} scoped={Boolean(memberId)} canCreate={can('task.create')} onCreate={() => requestQuickCreate('todo')}/>
      : <div className="task-board" data-columns={columns.length}>{columns.map((status) => {
        const inColumn = todos.filter((todo) => todo.status === status);
        return <section className="task-column" key={status} aria-labelledby={`column-${status}`}>
          <div className="section-head"><h2 id={`column-${status}`}>{taskStatusLabels[status]}</h2><StatusBadge>{inColumn.length}</StatusBadge></div>
          {inColumn.map((todo) => <TaskCard todo={todo} search={search} key={todo.id}/>)}
        </section>;
      })}</div>}
    </div>
    {active && <TaskDrawer key={active.id} todo={active} onClose={() => navigate(`/tasks${search}`, false, true)} onDeleted={setDeleted}/>}
    </div>
  </div>;
}

/**
 * タスクの空の状態。まだ1件もない・未完了が全部済んだ・絞り込みに合わない、を分ける。
 * 「全部済んだ」は、未完了（または自分の担当）が0件で、その中に完了したタスクがあるとき。追加のボタンは作れる人にだけ出す。
 */
function TasksEmpty({ filter, total, allDone, scoped, canCreate, onCreate }: { filter: TaskFilter; total: number; allDone: boolean; scoped: boolean; canCreate: boolean; onCreate: () => void }) {
  const add = canCreate ? <button data-control-id="tasks.empty.create" className="button primary" type="button" onClick={onCreate}>最初のタスクを追加</button> : undefined;
  if (scoped) return <EmptyState title="該当するタスクはありません" illustration={<EmptyTasks/>}><ScopeNote/></EmptyState>;
  if (total === 0) return <EmptyState title="まだタスクはありません" illustration={<EmptyTasks/>} action={add}>{canCreate ? '家族の用事を追加すると、担当する人と確認する人を分けて管理できます。' : '共有されたタスクが追加されると、ここに表示します。'}</EmptyState>;
  if (allDone) return <EmptyState title={filter === 'mine' ? '自分の担当は全部済みました' : 'タスクは全部済みました'} illustration={<EmptyDone/>} action={<button data-control-id="tasks.empty.show-done" className="button" type="button" onClick={() => navigate(withQueryParam('filter', 'done'), true, true)}>完了したタスクを見る</button>}>新しいタスクが追加されると、ここに表示します。</EmptyState>;
  return <EmptyState title="該当するタスクはありません" illustration={<EmptyTasks/>}>別の条件を選ぶか、タスクを追加してください。</EmptyState>;
}
