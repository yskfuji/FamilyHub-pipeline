import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { detailId, navigate, useSearch, withQueryParam } from '../../app/router';
import { ja, taskStatusLabels } from '../../content/ja';
import { DetailNotFound, EmptyState, PageHeader, StatusBadge } from '../../design-system/components';
import { useContentWide } from '../../design-system/DetailSurface';
import { CheckIcon } from '../../design-system/icons';
import { filterTasks, parseTaskFilter, taskColumns, taskCounts, taskFilters } from '../../domain/taskList';
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
      ? <EmptyState title="該当するタスクはありません">{memberId ? <ScopeNote/> : '別の条件を選ぶか、タスクを追加してください。'}</EmptyState>
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
