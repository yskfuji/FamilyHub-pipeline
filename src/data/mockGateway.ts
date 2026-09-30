import type { FamilyHubGateway } from './gateway';
import { baseSnapshot } from './fixtures';
import type { CalendarEvent, Expense, GatewayError, HouseholdSnapshot, Memo, Result, Scenario, Todo } from '../domain/types';

const delay = (ms = 90) => new Promise((resolve) => window.setTimeout(resolve, ms));
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = <T,>(error: GatewayError): Result<T> => ({ ok: false, error });
const copy = (): HouseholdSnapshot => structuredClone(baseSnapshot);

const scenarioError = (scenario?: Scenario): GatewayError | null => {
  if (scenario === 'offline') return { code: 'OFFLINE', message: 'ネットワークに接続できません。端末内の直近データを表示します。', retryable: true };
  if (scenario === 'conflict') return { code: 'CONFLICT', message: '別の端末で内容が更新されました。差分を確認してください。', retryable: true };
  if (scenario === 'expired-invite') return { code: 'UNAUTHENTICATED', message: '招待の有効期限が切れています。新しい招待を依頼してください。', retryable: false };
  if (scenario === 'expired-session') return { code: 'UNAUTHENTICATED', message: '安全のためセッションを終了しました。もう一度サインインしてください。', retryable: false };
  return null;
};

export function createMockGateway(): FamilyHubGateway {
  const state = copy();

  return {
    auth: {
      async beginPasskey() { await delay(); return ok({ challengeId: 'mock-passkey-challenge' }); },
      async signInWithPassword(email, password) {
        await delay();
        if (!email.includes('@') || password.length < 15) return fail({ code: 'INVALID_INPUT', message: '入力内容を確認してください。', retryable: false });
        return ok({ userId: state.user.id });
      },
      async signOut() { await delay(); return ok(undefined); },
    },
    household: {
      async getSnapshot(scenario) {
        await delay(scenario === 'loading' ? 700 : 80);
        const error = scenarioError(scenario);
        if (error) return fail(error);
        const snapshot = structuredClone(state);
        if (scenario === 'empty') {
          snapshot.events = []; snapshot.todos = []; snapshot.memos = []; snapshot.expenses = [];
        }
        if (scenario === 'quarantined') {
          snapshot.memos[0].attachments[0].status = 'quarantined';
          snapshot.memos[0].attachments[0].statusMessage = '安全確認中です。結果が出るまで開けません';
        }
        if (scenario === 'weather') snapshot.context.weather = { condition: 'storm', temperatureC: 20, precipitationPercent: 95, alert: '雷を伴う激しい雨のおそれ。屋外予定を確認してください' };
        return ok(snapshot);
      },
      async acceptInvite(code) {
        await delay();
        if (code === 'EXPIRED') return fail({ code: 'UNAUTHENTICATED', message: '招待の有効期限が切れています。', retryable: false });
        return ok({ householdId: state.household.id });
      },
    },
    events: {
      async createEvent(input) {
        await delay();
        const event: CalendarEvent = {
          id: `event-${Date.now()}`, householdId: state.household.id, ownerMembershipId: 'member-aoi',
          title: input.title, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone,
          participantMembershipIds: input.participantMembershipIds, recurrence: input.recurrence as CalendarEvent['recurrence'],
        };
        state.events = [...state.events, event];
        return ok(structuredClone(event));
      },
      async updateRecurrence(id, _scope, input) {
        await delay();
        const target = state.events.find((event) => event.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '予定が見つかりません。', retryable: false });
        Object.assign(target, input);
        return ok(structuredClone(target));
      },
    },
    todos: {
      async createTodo(input) {
        await delay();
        const todo: Todo = { id: `todo-${Date.now()}`, householdId: state.household.id, title: input.title, dueAt: input.dueAt, status: 'open', assigneeMembershipId: input.assigneeMembershipId, reviewerMembershipId: input.reviewerMembershipId, creatorMembershipId: 'member-aoi', version: 1 };
        state.todos = [todo, ...state.todos];
        return ok(structuredClone(todo));
      },
      async updateTodoStatus(id, status, expectedVersion) {
        await delay();
        const target = state.todos.find((todo) => todo.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: 'Todoが見つかりません。', retryable: false });
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で更新されています。現在の内容を確認してください。', retryable: true });
        target.status = status; target.version += 1;
        return ok(structuredClone(target));
      },
    },
    memos: {
      async uploadAttachment(memoId, file) {
        await delay(260);
        const target = state.memos.find((memo) => memo.id === memoId);
        if (!target) return fail({ code: 'INVALID_INPUT', message: 'メモが見つかりません。', retryable: false });
        if (file.size > 10_000_000 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
          return fail({ code: 'ATTACHMENT_REJECTED', message: '形式またはサイズが許可範囲外です。PDF・JPEG・PNG、10MB以内にしてください。', retryable: false });
        }
        const memo: Memo = structuredClone(target);
        memo.attachments.push({ id: `attachment-${Date.now()}`, memoId, originalName: file.name, mimeType: file.type, byteSize: file.size, status: 'quarantined', statusMessage: '隔離領域で安全確認中です' });
        Object.assign(target, memo);
        return ok(memo);
      },
    },
    expenses: {
      async createExpense(input) {
        await delay();
        const base = Math.floor(input.amountJpy / input.shareMembershipIds.length);
        let remainder = input.amountJpy - base * input.shareMembershipIds.length;
        const expense: Expense = {
          id: `expense-${Date.now()}`, householdId: state.household.id, title: input.title, amountJpy: input.amountJpy,
          incurredOn: input.incurredOn as Expense['incurredOn'], payerMembershipId: input.payerMembershipId, category: 'other', settlements: [],
          shares: input.shareMembershipIds.map((membershipId) => ({ membershipId, amountJpy: base + (remainder-- > 0 ? 1 : 0), settledJpy: membershipId === input.payerMembershipId ? base : 0 })),
        };
        state.expenses = [expense, ...state.expenses];
        return ok(structuredClone(expense));
      },
      async recordSettlement(expenseId, amountJpy) {
        await delay();
        const target = state.expenses.find((expense) => expense.id === expenseId);
        if (!target || !Number.isInteger(amountJpy) || amountJpy <= 0) return fail({ code: 'INVALID_INPUT', message: '精算額を確認してください。', retryable: false });
        const share = target.shares.find((item) => item.membershipId !== target.payerMembershipId && item.settledJpy < item.amountJpy);
        if (!share) return fail({ code: 'CONFLICT', message: 'すでに精算済みです。', retryable: false });
        const applied = Math.min(amountJpy, share.amountJpy - share.settledJpy);
        share.settledJpy += applied;
        target.settlements.push({ id: `settlement-${Date.now()}`, amountJpy: applied, fromMembershipId: share.membershipId, toMembershipId: target.payerMembershipId, recordedAt: '2026-09-30T07:45:00+09:00' });
        return ok(structuredClone(target));
      },
    },
    resources: {
      async search(query) {
        await delay(60);
        const normalized = query.trim().toLowerCase();
        if (!normalized) return ok([]);
        const results = [
          ...state.events.map((item) => ({ kind: '予定', id: item.id, label: item.title, destination: `/calendar/${item.id}` })),
          ...state.todos.map((item) => ({ kind: 'Todo', id: item.id, label: item.title, destination: `/tasks/${item.id}` })),
          ...state.memos.map((item) => ({ kind: 'メモ', id: item.id, label: item.title, destination: `/notes/${item.id}` })),
          ...state.resources.map((item) => ({ kind: 'リンク', id: item.id, label: item.label, destination: '/settings/resources' })),
        ].filter((item) => item.label.toLowerCase().includes(normalized));
        return ok(results.slice(0, 8));
      },
    },
    context: {
      async getContext() { await delay(60); return ok(structuredClone(state.context)); },
    },
  };
}
