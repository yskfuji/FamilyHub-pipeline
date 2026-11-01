import type { Id, Todo, TodoStatus } from './types';

/** タスクの一覧の絞り込み。URL の filter の値と同じ。 */
export type TaskFilter = 'open' | 'mine' | 'review' | 'done';

export const taskFilters: readonly TaskFilter[] = ['open', 'mine', 'review', 'done'];

export const parseTaskFilter = (value: string | null): TaskFilter => (taskFilters.includes(value as TaskFilter) ? value as TaskFilter : 'open');

const unfinished: readonly TodoStatus[] = ['open', 'doing', 'review', 'waiting'];
const columns: Record<TaskFilter, readonly TodoStatus[]> = { open: unfinished, mine: unfinished, review: ['review'], done: ['done'] };

/** 絞り込みごとに並べる状態の列。 */
export const taskColumns = (filter: TaskFilter) => columns[filter];

const matches = (todo: Todo, filter: TaskFilter, viewerId: Id) => columns[filter].includes(todo.status) && (filter !== 'mine' || todo.assigneeMembershipId === viewerId);

/** 期限の近い順。完了は新しい順。期限のないものはどちらでも最後。同じ期限は名前の順にして、読み直しても動かない。 */
export function filterTasks(todos: readonly Todo[], filter: TaskFilter, viewerId: Id): Todo[] {
  const direction = filter === 'done' ? -1 : 1;
  return todos.filter((todo) => matches(todo, filter, viewerId)).sort((a, b) => {
    if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return (Date.parse(a.dueAt) - Date.parse(b.dueAt)) * direction;
    if (Boolean(a.dueAt) !== Boolean(b.dueAt)) return a.dueAt ? -1 : 1;
    return a.title.localeCompare(b.title, 'ja');
  });
}

export function taskCounts(todos: readonly Todo[], viewerId: Id): Record<TaskFilter, number> {
  const count = (filter: TaskFilter) => todos.filter((todo) => matches(todo, filter, viewerId)).length;
  return { open: count('open'), mine: count('mine'), review: count('review'), done: count('done') };
}
