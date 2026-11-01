import type { TodoPort } from '../../data/gateway';
import { authorize, authorizeVisibleResource, canMutateOwnedResource } from '../../authz/policy';
import { dateKeyFromRfc3339 } from '../calendarDate';
import { nextOccurrenceAfter, occurrenceStartsAt } from '../recurrence';
import { todoInputSchema } from '../schemas';
import type { Todo } from '../types';
import { archive, conflict, denied, invalid, missing, ok, fail } from './context';
import type { CommandContext, SyncPort } from './context';

export function createTodoCommands(c: CommandContext): SyncPort<TodoPort> {
  const { a, state, nextId, now, viewer, requireCapability, offlineFailure, permissionConflict, withinRestoreWindow, defaultVisibility, foreignMember } = c;
  const seen = (item: Todo) => authorizeVisibleResource(viewer(), 'task.read', item.visibility, [item.creatorMembershipId, item.assigneeMembershipId, ...(item.reviewerMembershipId ? [item.reviewerMembershipId] : [])]).allowed;
  return {
    createTodo(input, context) {
      const revision = permissionConflict<Todo>(context); if (revision) return revision;
      const guard = requireCapability<Todo>('task.create'); if (guard) return guard;
      const network = offlineFailure<Todo>(); if (network) return network;
      const parsed = todoInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const outsider = foreignMember<Todo>([parsed.data.assigneeMembershipId, parsed.data.reviewerMembershipId]); if (outsider) return outsider;
      const todo: Todo = { ...parsed.data, id: nextId('todo'), householdId: state.household.id, status: 'open', creatorMembershipId: viewer().membershipId, version: 1, visibility: defaultVisibility() };
      state.todos = [todo, ...state.todos];
      return ok(structuredClone(todo));
    },
    updateTodoStatus(id, status, expectedVersion) {
      const target = state.todos.find((todo) => todo.id === id && !todo.deletedAt);
      if (!target || !seen(target)) return missing('タスク');
      const decision = authorize(viewer(), 'task.transition'); if (!decision.allowed) return denied(decision);
      if (![target.creatorMembershipId, target.assigneeMembershipId, target.reviewerMembershipId].includes(viewer().membershipId) && !['owner','adult'].includes(viewer().role)) return denied({ allowed: false, reason: 'SCOPE_DENIED' });
      const network = offlineFailure<Todo>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('タスク');
      if (status === 'review' && !target.reviewerMembershipId) return invalid([{ message: '確認する人が決まっていないため、確認を依頼できません。' }]);
      const next = status === 'done' && target.recurrence && target.dueAt ? nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt)) : null;
      if (next && target.dueAt) {
        // 繰り返しのタスクは、今回分を完了の記録として残し、シリーズは次の回へ進める。
        const done: Todo = { ...structuredClone(target), id: nextId('todo'), status: 'done', version: 1 };
        delete done.recurrence;
        state.todos = [done, ...state.todos];
        target.dueAt = occurrenceStartsAt(target.dueAt, next); target.status = 'open'; target.version += 1;
        return ok(structuredClone(done));
      }
      target.status = status; target.version += 1;
      return ok(structuredClone(target));
    },
    updateTodo(id, scope, input, expectedVersion, context) {
      const revision = permissionConflict<Todo>(context); if (revision) return revision;
      const target = state.todos.find((todo) => todo.id === id && !todo.deletedAt);
      if (!target || !seen(target)) return missing('タスク');
      const decision = canMutateOwnedResource(viewer(), 'task.update', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<Todo>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('タスク');
      const parsed = todoInputSchema.partial().safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const outsider = foreignMember<Todo>([parsed.data.assigneeMembershipId, parsed.data.reviewerMembershipId]); if (outsider) return outsider;
      if (scope === 'this' && target.recurrence && target.dueAt) {
        // 今回だけ変える: 今回分を切り出し、シリーズは次の回へ進める。
        const next = nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt));
        const single: Todo = { ...structuredClone(target), ...parsed.data, id: nextId('todo'), version: 1 };
        delete single.recurrence;
        archive(a.archives.todos, target.id, structuredClone(target));
        if (next) { target.dueAt = occurrenceStartsAt(target.dueAt, next); target.version += 1; } else target.deletedAt = now();
        state.todos = [single, ...state.todos];
        return ok(structuredClone(single));
      }
      Object.assign(target, parsed.data); target.version += 1;
      return ok(structuredClone(target));
    },
    deleteTodo(id, expectedVersion, scope = 'series') {
      const target = state.todos.find((item) => item.id === id && !item.deletedAt); if (!target || !seen(target)) return missing('タスク');
      const decision = canMutateOwnedResource(viewer(), 'task.delete', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<void>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('タスク');
      archive(a.archives.todos, id, structuredClone(target));
      const next = scope === 'this' && target.recurrence && target.dueAt ? nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt)) : null;
      if (next && target.dueAt) { target.dueAt = occurrenceStartsAt(target.dueAt, next); target.version += 1; }
      else target.deletedAt = now();
      return ok(undefined);
    },
    restoreTodo(id) {
      const archived = a.archives.todos[id]; const target = state.todos.find((item) => item.id === id);
      if (!archived || !target || !seen(target)) return missing('タスク');
      const decision = canMutateOwnedResource(viewer(), 'task.update', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
      if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      Object.assign(target, { ...archived, version: target.version + 1 });
      if (!archived.deletedAt) delete target.deletedAt;
      delete a.archives.todos[id];
      return ok(structuredClone(target));
    },
  };
}
