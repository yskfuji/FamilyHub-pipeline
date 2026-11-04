import { useCallback } from 'react';
import { useApp } from '../../app/AppContext';
import { ja, taskActionAriaLabel } from '../../content/ja';
import { inlineTodoAction, todoActionStatus, type TodoAction } from '../../domain/todoFlow';
import type { Todo } from '../../domain/types';

/** 状態を変えて、結果を知らせる。詳細と一覧で同じ処理を使う。成功したら true。 */
export function useTodoTransition() {
  const { gateway, refresh, announce } = useApp();
  return useCallback(async (todo: Todo, action: TodoAction, note?: string) => {
    const status = todoActionStatus[action];
    const result = await gateway.todos.updateTodoStatus(todo.id, status, todo.version, note?.trim() || undefined);
    if (!result.ok) { announce(result.error.message); return false; }
    await refresh();
    announce(`「${todo.title}」${ja.taskActionDone[action]}${todo.recurrence && status === 'done' ? '。次の回を作成しました' : ''}`);
    return true;
  }, [gateway, refresh, announce]);
}

/** 一覧の丸ボタン。押せないときは null。 */
export function useInlineTodoAction(todo: Todo) {
  const { snapshot } = useApp();
  const transition = useTodoTransition();
  const action = inlineTodoAction(todo, snapshot.viewer);
  return action && { label: taskActionAriaLabel(action, todo.status, todo.title), run: () => transition(todo, action) };
}
