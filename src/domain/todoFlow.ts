import { hasCapability } from '../authz/policy';
import type { Todo, TodoStatus, ViewerContext } from './types';

/** 状態を変える操作。文言は表示する側で付ける。 */
export type TodoAction = 'complete' | 'request-review' | 'confirm-done' | 'start' | 'wait' | 'reset' | 'reopen';

export const todoActionStatus: Record<TodoAction, TodoStatus> = {
  complete: 'done',
  'request-review': 'review',
  'confirm-done': 'done',
  start: 'doing',
  wait: 'waiting',
  reset: 'open',
  reopen: 'open',
};

export interface TodoFlow {
  /** いちばんに勧める操作。確認を待っている人には勧めるものがない。 */
  suggested: TodoAction | null;
  /** そのほかに選べる操作。確認の流れは案内で、強制はしない。 */
  others: TodoAction[];
  /** 自分ではない人の確認を待っているとき。 */
  awaitingReviewer: boolean;
}

type FlowTodo = Pick<Todo, 'status' | 'creatorMembershipId' | 'assigneeMembershipId' | 'reviewerMembershipId'>;

const noFlow: TodoFlow = { suggested: null, others: [], awaitingReviewer: false };

/** 状態を変えられる人。関わっている人と、管理者と大人のメンバー。 */
export function canTransitionTodo(viewer: ViewerContext, todo: FlowTodo): boolean {
  if (!hasCapability(viewer, 'task.transition')) return false;
  return viewer.role === 'owner' || viewer.role === 'adult' || [todo.creatorMembershipId, todo.assigneeMembershipId, todo.reviewerMembershipId].includes(viewer.membershipId);
}

function suggestedFor(todo: FlowTodo, viewerId: string): TodoAction | null {
  if (todo.status === 'done') return 'reopen';
  if (!todo.reviewerMembershipId) return 'complete';
  if (todo.reviewerMembershipId === viewerId) return todo.status === 'review' ? 'confirm-done' : 'complete';
  return todo.status === 'review' ? null : 'request-review';
}

/** 見ている人に合わせた次の操作。 */
export function todoFlowFor(todo: FlowTodo, viewer: ViewerContext): TodoFlow {
  if (!canTransitionTodo(viewer, todo)) return noFlow;
  const suggested = suggestedFor(todo, viewer.membershipId);
  if (todo.status === 'done') return { ...noFlow, suggested };
  const others = (['complete', 'start', 'wait', 'reset'] as const).filter((action) => {
    const target = todoActionStatus[action];
    return target !== todo.status && !(suggested && target === todoActionStatus[suggested]);
  });
  return { suggested, others, awaitingReviewer: suggested === null };
}

export type InlineTodoAction = Extract<TodoAction, 'complete' | 'request-review' | 'confirm-done'>;

/** 一覧の丸ボタンで行う操作。一覧でも詳細と同じ流れに従い、勧める操作だけを出す。 */
export function inlineTodoAction(todo: FlowTodo, viewer: ViewerContext): InlineTodoAction | null {
  const { suggested } = todoFlowFor(todo, viewer);
  return suggested === 'complete' || suggested === 'request-review' || suggested === 'confirm-done' ? suggested : null;
}
