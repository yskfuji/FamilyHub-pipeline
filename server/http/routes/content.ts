import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idSchema, isoDateSchema } from '../../../src/domain/schemas';
import type { IsoDate, MutationContext, RecurrenceScope, Todo } from '../../../src/domain/types';
import type { AppDeps, RouteDeclaration } from '../context';
import { parse } from '../parse';
import { mutate, read } from '../rules';

const declare = (operationId: string, overrides: Partial<RouteDeclaration> = {}) => ({ route: { operationId, auth: 'session', csrf: true, capability: 'rule', idempotent: true, ...overrides } as RouteDeclaration });
const reading = (operationId: string) => declare(operationId, { csrf: false, idempotent: false });
const param = (request: { params: unknown }, name: string) => parse(idSchema, (request.params as Record<string, unknown>)[name]);
const query = (request: { query: unknown }) => request.query as Record<string, unknown>;

const scopeSchema = z.enum(['this', 'future', 'series']);
const versionSchema = z.coerce.number().int();
/** 権限の版の照合は入口で済ませているので、規則には渡さない。 */
const noContext: MutationContext | undefined = undefined;

const eventPatch = z.object({ scope: scopeSchema, input: z.unknown(), expectedVersion: z.number().int(), occurrenceDate: isoDateSchema.optional() });
const todoPatch = z.object({ scope: scopeSchema, input: z.unknown(), expectedVersion: z.number().int() });
const statusPatch = z.object({ status: z.enum(['open', 'doing', 'review', 'waiting', 'done']), expectedVersion: z.number().int(), note: z.string().max(500).optional() });
const memoPatch = z.object({ input: z.unknown(), expectedVersion: z.number().int() });
const settlement = z.object({ fromMembershipId: idSchema, amountJpy: z.number() });

export function registerContentRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post('/v1/events', { config: declare('createEvent', { successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.events.createEvent(request.body as never, noContext)));
  app.patch('/v1/events/:eventId', { config: declare('updateRecurringEvent') }, (request, reply) => {
    const body = parse(eventPatch, request.body);
    return mutate(deps, request, reply, (rules) => rules.events.updateEvent(param(request, 'eventId'), body.scope as RecurrenceScope, body.input as never, body.expectedVersion, noContext, body.occurrenceDate as IsoDate | undefined));
  });
  app.delete('/v1/events/:eventId', { config: declare('deleteEvent') }, (request, reply) => {
    const { scope, expectedVersion, occurrenceDate } = parse(z.object({ scope: scopeSchema, expectedVersion: versionSchema, occurrenceDate: isoDateSchema.optional() }), query(request));
    return mutate(deps, request, reply, (rules) => rules.events.deleteEvent(param(request, 'eventId'), scope, expectedVersion, occurrenceDate as IsoDate | undefined));
  });
  app.post('/v1/events/:eventId/restore', { config: declare('restoreEvent') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.events.restoreEvent(param(request, 'eventId'), parse(isoDateSchema.optional(), (request.query as Record<string, unknown>).occurrenceDate) as IsoDate | undefined)));

  app.post('/v1/todos', { config: declare('createTodo', { successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.todos.createTodo(request.body as never, noContext)));
  app.patch('/v1/todos/:todoId/status', { config: declare('updateTodoStatus') }, (request, reply) => {
    const body = parse(statusPatch, request.body);
    return mutate(deps, request, reply, (rules) => rules.todos.updateTodoStatus(param(request, 'todoId'), body.status as Todo['status'], body.expectedVersion, body.note));
  });
  app.patch('/v1/todos/:todoId', { config: declare('updateTodo') }, (request, reply) => {
    const body = parse(todoPatch, request.body);
    return mutate(deps, request, reply, (rules) => rules.todos.updateTodo(param(request, 'todoId'), body.scope, body.input as never, body.expectedVersion, noContext));
  });
  app.delete('/v1/todos/:todoId', { config: declare('deleteTodo') }, (request, reply) => {
    const { scope, expectedVersion } = parse(z.object({ scope: scopeSchema.default('series'), expectedVersion: versionSchema }), query(request));
    return mutate(deps, request, reply, (rules) => rules.todos.deleteTodo(param(request, 'todoId'), expectedVersion, scope));
  });
  app.post('/v1/todos/:todoId/restore', { config: declare('restoreTodo') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.todos.restoreTodo(param(request, 'todoId'))));

  app.post('/v1/memos', { config: declare('createMemo', { successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.memos.createMemo(request.body as never, noContext)));
  app.patch('/v1/memos/:memoId', { config: declare('updateMemo') }, (request, reply) => {
    const body = parse(memoPatch, request.body);
    return mutate(deps, request, reply, (rules) => rules.memos.updateMemo(param(request, 'memoId'), body.input as never, body.expectedVersion, noContext));
  });
  app.delete('/v1/memos/:memoId', { config: declare('deleteMemo') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.memos.deleteMemo(param(request, 'memoId'))));
  app.post('/v1/memos/:memoId/restore', { config: declare('restoreMemo') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.memos.restoreMemo(param(request, 'memoId'))));

  app.post('/v1/expenses', { config: declare('createExpense', { successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.expenses.createExpense(request.body as never)));
  app.patch('/v1/expenses/:expenseId', { config: declare('updateExpense', { recentAuth: true }) }, (request, reply) => {
    const body = parse(memoPatch, request.body);
    return mutate(deps, request, reply, (rules) => rules.expenses.updateExpense(param(request, 'expenseId'), body.input as never, body.expectedVersion));
  });
  app.delete('/v1/expenses/:expenseId', { config: declare('deleteExpense', { recentAuth: true }) }, (request, reply) => {
    const expected = parse(versionSchema, query(request).expectedVersion);
    return mutate(deps, request, reply, (rules) => rules.expenses.deleteExpense(param(request, 'expenseId'), expected));
  });
  app.post('/v1/expenses/:expenseId/restore', { config: declare('restoreExpense', { recentAuth: true }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.expenses.restoreExpense(param(request, 'expenseId'))));
  app.post('/v1/expenses/:expenseId/settlements', { config: declare('recordSettlement', { recentAuth: true, successStatus: 201 }) }, (request, reply) => {
    const body = parse(settlement, request.body);
    return mutate(deps, request, reply, (rules) => rules.expenses.recordSettlement(param(request, 'expenseId'), body.fromMembershipId, body.amountJpy));
  });
  app.post('/v1/expenses/:expenseId/settlements/:settlementId/reverse', { config: declare('reverseSettlement', { recentAuth: true, successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.expenses.reverseSettlement(param(request, 'expenseId'), param(request, 'settlementId'))));
  // まとめた精算（A4）。検査と記録は規則（src/domain/commands/expenses.ts）が1つのトランザクションの中で行う。
  app.post('/v1/settlement-batches', { config: declare('settleAll', { recentAuth: true, successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.expenses.settleAll(request.body as never)));
  app.post('/v1/settlement-batches/:batchId/reverse', { config: declare('reverseBatch', { recentAuth: true, successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.expenses.reverseBatch(param(request, 'batchId'))));

  app.get('/v1/search', { config: reading('searchHousehold') }, (request, reply) => read(deps, request, reply, (rules) => rules.resources.search(parse(z.string().max(200), query(request).q)), { searchableMedia: true }));
  app.get('/v1/insights', { config: reading('listInsights') }, (request, reply) => read(deps, request, reply, (rules) => rules.insights.list()));

  app.get('/v1/notifications', { config: reading('listNotifications') }, (request, reply) => read(deps, request, reply, (rules) => rules.notifications.list()));
  app.post('/v1/notifications/:notificationId/read', { config: declare('markNotificationRead') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.notifications.markRead(param(request, 'notificationId'))));
  app.post('/v1/notifications/:notificationId/snooze', { config: declare('snoozeNotification') }, (request, reply) => {
    const { minutes } = parse(z.object({ minutes: z.literal(30) }), request.body);
    return mutate(deps, request, reply, (rules) => rules.notifications.snooze(param(request, 'notificationId'), minutes));
  });
  app.post('/v1/notifications/:notificationId/stop', { config: declare('stopNotification') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.notifications.stop(param(request, 'notificationId'))));
  app.post('/v1/notifications/:notificationId/resume', { config: declare('resumeNotification') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.notifications.resume(param(request, 'notificationId'))));
  app.get('/v1/notification-preferences', { config: reading('getNotificationPreferences') }, (request, reply) => read(deps, request, reply, (rules) => rules.notifications.getPreferences()));
  app.patch('/v1/notification-preferences', { config: declare('updateNotificationPreferences') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.notifications.updatePreferences(request.body as never)));
}
