import { describe, expect, it } from 'vitest';
import { filterTasks, parseTaskFilter, taskColumns, taskCounts } from './taskList';
import type { Todo } from './types';

const todo = (title: string, changes: Partial<Todo> = {}) => ({ id: title, title, status: 'open', assigneeMembershipId: 'me', ...changes }) as Todo;
const todos = [
  todo('なし'),
  todo('遅い', { dueAt: '2026-10-02T09:00:00+09:00' }),
  todo('早い', { dueAt: '2026-10-01T09:00:00+09:00', status: 'doing' }),
  todo('確認', { dueAt: '2026-10-03T09:00:00+09:00', status: 'review', assigneeMembershipId: 'other' }),
  todo('待ち', { dueAt: '2026-10-04T09:00:00+09:00', status: 'waiting' }),
  todo('完了古い', { dueAt: '2026-09-01T09:00:00+09:00', status: 'done' }),
  todo('完了新しい', { dueAt: '2026-09-02T09:00:00+09:00', status: 'done' }),
  todo('完了期限なし', { status: 'done' }),
];
const titles = (filter: 'open' | 'mine' | 'review' | 'done') => filterTasks(todos, filter, 'me').map((item) => item.title);

describe('task list', () => {
  it('reads the filter from the URL and falls back to unfinished tasks', () => {
    expect(parseTaskFilter('done')).toBe('done');
    expect(parseTaskFilter('all')).toBe('open');
    expect(parseTaskFilter(null)).toBe('open');
  });

  it('sorts by due date with undated tasks last, newest first once done', () => {
    expect(titles('open')).toEqual(['早い', '遅い', '確認', '待ち', 'なし']);
    expect(titles('done')).toEqual(['完了新しい', '完了古い', '完了期限なし']);
  });

  it('filters by assignee and status, and counts each filter', () => {
    expect(titles('mine')).toEqual(['早い', '遅い', '待ち', 'なし']);
    expect(titles('review')).toEqual(['確認']);
    expect(taskCounts(todos, 'me')).toEqual({ open: 5, mine: 4, review: 1, done: 3 });
  });

  it('breaks ties by name so the order never shuffles', () => {
    const due = '2026-10-01T09:00:00+09:00';
    expect(filterTasks([todo('い', { dueAt: due }), todo('あ', { dueAt: due })], 'open', 'me').map((item) => item.title)).toEqual(['あ', 'い']);
  });

  it('keeps all five statuses reachable through the columns', () => {
    expect(new Set([...taskColumns('open'), ...taskColumns('done')])).toEqual(new Set(['open', 'doing', 'review', 'waiting', 'done']));
  });
});
