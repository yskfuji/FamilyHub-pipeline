import { useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { detailId, navigate, useSearch, withQueryParam } from '../../app/router';
import { ja, taskStatusLabels } from '../../content/ja';
import { DetailNotFound, EmptyState, PageHeader, StatusBadge } from '../../design-system/components';
import { CheckIcon } from '../../design-system/icons';
import { filterTasks, parseTaskFilter, taskColumns, taskCounts, taskFilters } from '../../domain/taskList';
import type { Todo } from '../../domain/types';
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
  const todos = useMemo(() => filterTasks(snapshot.todos, filter, viewerId), [snapshot.todos, filter, viewerId]);
  const counts = useMemo(() => taskCounts(snapshot.todos, viewerId), [snapshot.todos, viewerId]);
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
    <PageHeader eyebrow="タスク" title="家族のタスク" description="担当する人と確認する人を分けて管理できます。" action={can('task.create') ? <button data-control-id="tasks.create.open" className="button primary" type="button" onClick={() => requestQuickCreate('todo')}>タスクを追加</button> : undefined}/>
    {deleted && <div className="callout info" role="status"><CheckIcon/><div><strong>「{deleted.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id="tasks.restore" className="button" type="button" onClick={() => void restore()}>{ja.actions.restore}</button></div>}
    {activeId && !active && <DetailNotFound what="タスク" feature="tasks" backHref={`/tasks${search}`}/>}
    <div className="section-head filter-head">
      <div className="segmented" role="group" aria-label="タスクの絞り込み">{taskFilters.map((value) => <button data-control-id={`tasks.filter.${value}`} key={value} type="button" aria-pressed={filter === value} onClick={() => navigate(withQueryParam('filter', value === 'open' ? null : value), true, true)}>{ja.taskFilter[value]} {counts[value]}</button>)}</div>
      <span className="meta">{todos.length}件</span>
    </div>
    {todos.length === 0
      ? <EmptyState title="該当するタスクはありません">別の条件を選ぶか、タスクを追加してください。</EmptyState>
      : <div className="task-board" data-columns={columns.length}>{columns.map((status) => {
        const inColumn = todos.filter((todo) => todo.status === status);
        return <section className="task-column" key={status} aria-labelledby={`column-${status}`}>
          <div className="section-head"><h2 id={`column-${status}`}>{taskStatusLabels[status]}</h2><StatusBadge>{inColumn.length}</StatusBadge></div>
          {inColumn.map((todo) => <TaskCard todo={todo} search={search} key={todo.id}/>)}
        </section>;
      })}</div>}
    {active && <TaskDrawer key={active.id} todo={active} onClose={() => navigate(`/tasks${search}`, false, true)} onDeleted={setDeleted}/>}
  </div>;
}
