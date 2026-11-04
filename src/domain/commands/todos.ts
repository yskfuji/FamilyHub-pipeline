import type { TodoPort } from '../../data/gateway';
import { authorize, authorizeVisibleResource, canDeleteResource, canMutateOwnedResource } from '../../authz/policy';
import { dateKeyFromRfc3339, toJstRfc3339 } from '../calendarDate';
import { nextOccurrenceAfter, occurrenceStartsAt } from '../recurrence';
import { todoInputSchema, todoUpdateSchema } from '../schemas';
import type { Todo } from '../types';
import { applyPatch, archive, conflict, denied, invalid, missing, ok, fail } from './context';
import type { CommandContext, SyncPort } from './context';

/** 繰り返しのタスクを次の回へ進める。期間のタスクは開始も同じだけ動かして、長さを保つ。 */
function moveToOccurrence(todo: Todo, occurrence: string) {
  if (!todo.dueAt) return;
  const moved = occurrenceStartsAt(todo.dueAt, occurrence);
  if (todo.dueStartAt) todo.dueStartAt = toJstRfc3339(new Date(Date.parse(todo.dueStartAt) + Date.parse(moved) - Date.parse(todo.dueAt)));
  todo.dueAt = moved;
}

export function createTodoCommands(c: CommandContext): SyncPort<TodoPort> {
  const { a, state, nextId, now, viewer, requireCapability, offlineFailure, permissionConflict, withinRestoreWindow, defaultVisibility, foreignMember, foreignLabel, resolveVisibility } = c;
  const stakeholders = (item: Todo) => [item.creatorMembershipId, item.assigneeMembershipId];
  const rangeInvalid = (start?: string | null, end?: string | null) => Boolean(start && end && Date.parse(start) > Date.parse(end));
  const seen = (item: Todo) => authorizeVisibleResource(viewer(), 'task.read', item.visibility, [item.creatorMembershipId, item.assigneeMembershipId, ...(item.reviewerMembershipId ? [item.reviewerMembershipId] : [])]).allowed;
  return {
    createTodo(input, context) {
      const revision = permissionConflict<Todo>(context); if (revision) return revision;
      const guard = requireCapability<Todo>('task.create'); if (guard) return guard;
      const network = offlineFailure<Todo>(); if (network) return network;
      const parsed = todoInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const outsider = foreignMember<Todo>([parsed.data.assigneeMembershipId, parsed.data.reviewerMembershipId]); if (outsider) return outsider;
      const label = foreignLabel<Todo>(parsed.data.colorLabelId); if (label) return label;
      if (rangeInvalid(parsed.data.dueStartAt, parsed.data.dueAt)) return invalid([{ message: '終わりは始まりより後にしてください。' }]);
      const { visibility: requested, ...fields } = parsed.data;
      const visibility = requested ? resolveVisibility(requested, viewer().membershipId) : ok(defaultVisibility());
      if (!visibility.ok) return visibility;
      const todo: Todo = { ...fields, recurrence: fields.recurrence as Todo['recurrence'], id: nextId('todo'), householdId: state.household.id, status: 'open', creatorMembershipId: viewer().membershipId, version: 1, visibility: visibility.value };
      state.todos = [todo, ...state.todos];
      return ok(structuredClone(todo));
    },
    updateTodoStatus(id, status, expectedVersion, note) {
      const target = state.todos.find((todo) => todo.id === id && !todo.deletedAt);
      if (!target || !seen(target)) return missing('タスク');
      const decision = authorize(viewer(), 'task.transition'); if (!decision.allowed) return denied(decision);
      if (![target.creatorMembershipId, target.assigneeMembershipId, target.reviewerMembershipId].includes(viewer().membershipId) && !['owner','adult'].includes(viewer().role)) return denied({ allowed: false, reason: 'SCOPE_DENIED' });
      const network = offlineFailure<Todo>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('タスク');
      if (status === 'review' && !target.reviewerMembershipId) return invalid([{ message: '確認する人が決まっていないため、確認を依頼できません。' }]);
      if (note !== undefined && note.length > 500) return invalid([{ message: '一言は500文字以内にしてください。' }]);
      const comment = note?.trim() ? (status === 'done' ? { completionNote: note.trim() } : { handoffNote: note.trim() }) : {};
      const next = status === 'done' && target.recurrence && target.dueAt ? nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt)) : null;
      if (next && target.dueAt) {
        // 繰り返しのタスクは、今回分を完了の記録として残し、シリーズは次の回へ進める。
        const done: Todo = { ...structuredClone(target), ...comment, id: nextId('todo'), status: 'done', version: 1 };
        delete done.recurrence;
        state.todos = [done, ...state.todos];
        moveToOccurrence(target, next); target.status = 'open'; target.version += 1;
        return ok(structuredClone(done));
      }
      Object.assign(target, comment); target.status = status; target.version += 1;
      return ok(structuredClone(target));
    },
    updateTodo(id, scope, input, expectedVersion, context) {
      const revision = permissionConflict<Todo>(context); if (revision) return revision;
      const target = state.todos.find((todo) => todo.id === id && !todo.deletedAt);
      if (!target || !seen(target)) return missing('タスク');
      const decision = canMutateOwnedResource(viewer(), 'task.update', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<Todo>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('タスク');
      const parsed = todoUpdateSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const outsider = foreignMember<Todo>([parsed.data.assigneeMembershipId, parsed.data.reviewerMembershipId ?? undefined]); if (outsider) return outsider;
      const label = foreignLabel<Todo>(parsed.data.colorLabelId); if (label) return label;
      const { visibility: requested, ...fields } = parsed.data;
      const visibility = requested ? resolveVisibility(requested, target.visibility.creatorMembershipId) : null;
      if (visibility && !visibility.ok) return visibility;
      const changes = { ...fields, ...(visibility?.ok ? { visibility: visibility.value } : {}) };
      const after = { dueStartAt: changes.dueStartAt === undefined ? target.dueStartAt : changes.dueStartAt, dueAt: changes.dueAt === undefined ? target.dueAt : changes.dueAt };
      if (rangeInvalid(after.dueStartAt, after.dueAt)) return invalid([{ message: '終わりは始まりより後にしてください。' }]);
      if (scope === 'this' && target.recurrence && target.dueAt) {
        // 今回だけ変える: 今回分を切り出し、シリーズは次の回へ進める。
        const next = nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt));
        const single: Todo = { ...structuredClone(target), id: nextId('todo'), version: 1 };
        applyPatch(single, changes);
        delete single.recurrence;
        archive(a.archives.todos, target.id, structuredClone(target));
        if (next) { moveToOccurrence(target, next); target.version += 1; } else target.deletedAt = now();
        state.todos = [single, ...state.todos];
        return ok(structuredClone(single));
      }
      applyPatch(target, changes); target.version += 1;
      return ok(structuredClone(target));
    },
    deleteTodo(id, expectedVersion, scope = 'series') {
      const target = state.todos.find((item) => item.id === id && !item.deletedAt); if (!target || !seen(target)) return missing('タスク');
      const decision = canDeleteResource(viewer(), 'task.delete', stakeholders(target)); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<void>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('タスク');
      archive(a.archives.todos, id, structuredClone(target));
      const next = scope === 'this' && target.recurrence && target.dueAt ? nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt)) : null;
      if (next) { moveToOccurrence(target, next); target.version += 1; }
      else target.deletedAt = now();
      return ok(undefined);
    },
    restoreTodo(id) {
      const archived = a.archives.todos[id]; const target = state.todos.find((item) => item.id === id);
      if (!archived || !target || !seen(target)) return missing('タスク');
      const decision = canDeleteResource(viewer(), 'task.delete', stakeholders(target)); if (!decision.allowed) return denied(decision);
      if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      Object.assign(target, { ...archived, version: target.version + 1 });
      if (!archived.deletedAt) delete target.deletedAt;
      delete a.archives.todos[id];
      return ok(structuredClone(target));
    },
  };
}
