import type { FamilyHubGateway } from './gateway';
import { baseNotificationPreferences, baseNotifications, basePrivacySettings, baseSecurityOverview, baseSnapshot } from './fixtures';
import { memoInputSchema, passwordSchema } from '../domain/schemas';
import type { Authenticator, CalendarEvent, Expense, GatewayError, HouseholdNotification, HouseholdSnapshot, Memo, NotificationPreferences, PrivacySettings, Result, Scenario, SecurityOverview, Todo } from '../domain/types';

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
  const security: SecurityOverview = structuredClone(baseSecurityOverview);
  const notifications: HouseholdNotification[] = structuredClone(baseNotifications);
  let notificationPreferences: NotificationPreferences = structuredClone(baseNotificationPreferences);
  let privacy: PrivacySettings = structuredClone(basePrivacySettings);
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-mock-${++sequence}`;

  return {
    auth: {
      async beginPasskey() { await delay(); return ok({ challengeId: 'mock-passkey-challenge' }); },
      async signInWithPassword(email, password) {
        await delay();
        if (!email.includes('@') || password.length < 15) return fail({ code: 'INVALID_INPUT', message: '入力内容を確認してください。', retryable: false });
        return ok({ userId: state.user.id });
      },
      async signOut() { await delay(); return ok(undefined); },
      async getSecurityOverview() { await delay(); return ok(structuredClone(security)); },
      async beginPasskeyRegistration() { await delay(); return ok({ challengeId: nextId('challenge'), publicKey: null }); },
      async finishPasskeyRegistration(challengeId, credential) {
        await delay();
        if (!challengeId || !credential) return fail({ code: 'INVALID_INPUT', message: 'パスキー登録を完了できませんでした。', retryable: true });
        const authenticator: Authenticator = { id: nextId('authenticator'), label: 'この端末（デモ）', createdAt: '2026-09-30T07:45:00+09:00', kind: 'passkey', demo: true };
        security.authenticators.push(authenticator);
        return ok(structuredClone(authenticator));
      },
      async changePassword(currentPassword, newPassword) {
        await delay();
        if (!passwordSchema.safeParse(currentPassword).success) return fail({ code: 'UNAUTHENTICATED', message: '現在のパスワードを確認してください。', retryable: false });
        const parsed = passwordSchema.safeParse(newPassword);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。', retryable: false });
        return ok(undefined);
      },
      async revokeSession(sessionId) {
        await delay();
        const target = security.sessions.find((session) => session.id === sessionId);
        if (!target || target.current) return fail({ code: 'FORBIDDEN', message: 'このセッションはここから終了できません。', retryable: false });
        security.sessions.splice(security.sessions.indexOf(target), 1);
        return ok(undefined);
      },
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
      async updateMembershipRole(id, role, expectedVersion) {
        await delay();
        const target = state.memberships.find((member) => member.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: 'メンバーが見つかりません。', retryable: false });
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で権限が更新されています。', retryable: true });
        const activeOwners = state.memberships.filter((member) => member.status === 'active' && member.role === 'owner');
        if (target.role === 'owner' && role !== 'owner' && activeOwners.length === 1) return fail({ code: 'FORBIDDEN', message: '世帯には少なくとも1人のownerが必要です。先に別のownerを追加してください。', retryable: false });
        target.role = role; target.version += 1;
        return ok(structuredClone(target));
      },
      async createInvite(role) {
        await delay();
        const invite = { id: nextId('invite'), householdId: state.household.id, role, token: `FAMILY-2026-${String(sequence).padStart(4, '0')}-ONE-TIME`, expiresAt: '2026-10-01T07:45:00+09:00', remainingUses: 1 } as const;
        return ok(structuredClone(invite));
      },
      async savePrivacySettings(settings) { await delay(); privacy = structuredClone(settings); return ok(structuredClone(privacy)); },
    },
    events: {
      async createEvent(input) {
        await delay();
        const event: CalendarEvent = {
          id: `event-${Date.now()}`, householdId: state.household.id, ownerMembershipId: 'member-aoi',
          title: input.title, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone,
          participantMembershipIds: input.participantMembershipIds, recurrence: input.recurrence as CalendarEvent['recurrence'], location: input.location, weatherSensitive: input.weatherSensitive, version: 1,
        };
        state.events = [...state.events, event];
        return ok(structuredClone(event));
      },
      async updateEvent(id, _scope, input, expectedVersion) {
        await delay();
        const target = state.events.find((event) => event.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '予定が見つかりません。', retryable: false });
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で予定が更新されています。', retryable: true });
        Object.assign(target, input); target.version += 1;
        return ok(structuredClone(target));
      },
      async deleteEvent(id, _scope, expectedVersion) {
        await delay();
        const target = state.events.find((event) => event.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '予定が見つかりません。', retryable: false });
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で予定が更新されています。', retryable: true });
        state.events = state.events.filter((event) => event.id !== id);
        return ok(undefined);
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
      async updateTodo(id, _scope, input, expectedVersion) {
        await delay();
        const target = state.todos.find((todo) => todo.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: 'Todoが見つかりません。', retryable: false });
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で更新されています。現在の内容を確認してください。', retryable: true });
        Object.assign(target, input); target.version += 1;
        return ok(structuredClone(target));
      },
    },
    memos: {
      async createMemo(input) {
        await delay();
        const parsed = memoInputSchema.safeParse(input);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '入力を確認してください。', retryable: false });
        const memo: Memo = { id: nextId('memo'), householdId: state.household.id, ...parsed.data, updatedAt: '2026-09-30T07:45:00+09:00', authorMembershipId: 'member-aoi', attachments: [] };
        state.memos = [memo, ...state.memos];
        return ok(structuredClone(memo));
      },
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
    notifications: {
      async list() { await delay(50); return ok(structuredClone(notifications)); },
      async markRead(id) {
        await delay(50); const target = notifications.find((item) => item.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '通知が見つかりません。', retryable: false });
        target.read = true; return ok(structuredClone(target));
      },
      async snooze(id, minutes) {
        await delay(); const target = notifications.find((item) => item.id === id);
        if (!target || minutes !== 30) return fail({ code: 'INVALID_INPUT', message: '通知を延期できません。', retryable: false });
        target.status = 'snoozed'; target.remindAt = '2026-09-30T18:00:00+09:00'; return ok(structuredClone(target));
      },
      async stop(id) {
        await delay(); const target = notifications.find((item) => item.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '通知が見つかりません。', retryable: false });
        target.status = 'stopped'; return ok(structuredClone(target));
      },
      async getPreferences() { await delay(50); return ok(structuredClone(notificationPreferences)); },
      async updatePreferences(input) { await delay(); notificationPreferences = { ...notificationPreferences, ...input }; return ok(structuredClone(notificationPreferences)); },
    },
    credentials: {
      async create() { await delay(); return ok({ id: nextId('mock-credential'), demo: true }); },
    },
  };
}
