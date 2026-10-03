import type { FamilyHubGateway } from './gateway';
import { baseNotificationPreferences, baseNotifications, basePrivacySettings, baseSecurityOverview, baseSnapshot } from './fixtures';
import { expenseInputSchema, memoInputSchema, passwordSchema, privacySettingsSchema } from '../domain/schemas';
import { authorize, canMutateOwnedResource, capabilitiesFor, capabilityCeilingFor, projectSnapshotForViewer, redactPlace } from '../authz/policy';
import type { Authenticator, AuthorizationDecision, CalendarEvent, Capability, Expense, GatewayError, HouseholdInvite, HouseholdNotification, HouseholdSnapshot, Id, Memo, MutationContext, NotificationPreferences, PermissionOverride, PlaceRef, PrivacySettings, Result, Scenario, SecurityOverview, Todo } from '../domain/types';
import { ja } from '../content/ja';

const delay = (ms = 90) => new Promise((resolve) => window.setTimeout(resolve, ms));
const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = <T,>(error: GatewayError): Result<T> => ({ ok: false, error });
const copy = (): HouseholdSnapshot => structuredClone(baseSnapshot);
const denied = <T,>(decision: AuthorizationDecision, message = ja.errors.FORBIDDEN): Result<T> => fail({ code: 'FORBIDDEN', message, retryable: false, reason: decision.allowed ? 'CAPABILITY_MISSING' : decision.reason });
const missing = <T,>(label: string): Result<T> => fail({ code: 'NOT_FOUND', message: `${label}が見つからないか、表示する権限がありません。`, retryable: false });

const scenarioError = (scenario?: Scenario): GatewayError | null => {
  if (scenario === 'offline') return { code: 'OFFLINE', message: 'インターネットに接続できません。最後に取得した内容を表示しています。', retryable: true };
  if (scenario === 'conflict') return { code: 'CONFLICT', message: 'ほかの端末で内容が変更されました。最新の内容を確認してください。', retryable: true };
  if (scenario === 'expired-invite') return { code: 'UNAUTHENTICATED', message: '招待の有効期限が切れています。新しい招待を依頼してください。', retryable: false };
  if (scenario === 'expired-session') return { code: 'UNAUTHENTICATED', message: 'サインインの有効期限が切れました。もう一度サインインしてください。', retryable: false };
  return null;
};

export function createMockGateway(actorMembershipId: Id = 'member-aoi'): FamilyHubGateway {
  const state = copy();
  const security: SecurityOverview = structuredClone(baseSecurityOverview);
  const notifications: HouseholdNotification[] = structuredClone(baseNotifications);
  let notificationPreferences: NotificationPreferences = structuredClone(baseNotificationPreferences);
  let privacy: PrivacySettings = structuredClone(basePrivacySettings);
  let permissionOverrides: PermissionOverride[] = [];
  let permissionRevision = 1;
  let offline = false;
  const invites: HouseholdInvite[] = [];
  const archivedEvents = new Map<Id, CalendarEvent>();
  const archivedTodos = new Map<Id, Todo>();
  const archivedMemos = new Map<Id, Memo>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-mock-${++sequence}`;
  const actor = () => state.memberships.find((item) => item.id === actorMembershipId) ?? state.memberships[0];
  const viewer = () => {
    const member = actor();
    const overrides = permissionOverrides.filter((item) => item.membershipId === member.id);
    return { userId: member.userId, membershipId: member.id, role: member.role, status: member.status, capabilities: capabilitiesFor(member.role, overrides), permissionRevision } as HouseholdSnapshot['viewer'];
  };
  const requireCapability = <T,>(capability: Capability): Result<T> | null => {
    const decision = authorize(viewer(), capability);
    return decision.allowed ? null : denied<T>(decision);
  };
  const offlineFailure = <T,>(): Result<T> | null => offline ? fail({ code: 'OFFLINE', message: 'インターネットに接続できません。接続後にもう一度お試しください。', retryable: true }) : null;
  const permissionConflict = <T,>(context?: MutationContext): Result<T> | null => context && context.expectedPermissionRevision !== permissionRevision
    ? fail({ code: 'CONFLICT', message: '権限が変更されています。現在の権限で内容を確認してください。', retryable: false, reason: 'PERMISSION_REVISION' })
    : null;
  const visible = <T extends { place?: PlaceRef }>(item: T): T => redactPlace(structuredClone(item), viewer());
  const placeWriteGuard = <T,>(place: unknown): Result<T> | null => {
    if (place === undefined) return null;
    const decision = authorize(viewer(), 'place.read');
    return decision.allowed ? null : denied<T>(decision);
  };
  const invalid = <T,>(issues: Array<{ message: string }>): Result<T> => fail({ code: 'INVALID_INPUT', message: issues[0]?.message ?? '入力を確認してください。', retryable: false });
  const project = (): HouseholdSnapshot => {
    const current = viewer();
    const snapshot = projectSnapshotForViewer(state, current);
    snapshot.permissionOverrides = current.role === 'owner' ? structuredClone(permissionOverrides) : [];
    snapshot.user = { ...snapshot.user, id: current.userId, displayName: actor().displayName, email: `${current.userId}@example.test` };
    return snapshot;
  };

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
        if (!target || target.current) return fail({ code: 'FORBIDDEN', message: 'この端末はここからサインアウトできません。', retryable: false });
        security.sessions.splice(security.sessions.indexOf(target), 1);
        return ok(undefined);
      },
    },
    household: {
      async getSnapshot(scenario) {
        await delay(scenario === 'loading' ? 700 : 80);
        offline = scenario === 'offline';
        const error = scenarioError(scenario);
        if (error) return fail(error);
        const snapshot = project();
        if (scenario === 'empty') {
          snapshot.events = []; snapshot.todos = []; snapshot.memos = []; snapshot.expenses = [];
        }
        if (scenario === 'quarantined') {
          snapshot.memos[0].attachments[0].status = 'quarantined';
          snapshot.memos[0].attachments[0].statusMessage = 'ファイルを確認しています。完了するまで開けません';
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
        const guard = requireCapability<HouseholdSnapshot['memberships'][number]>('household.members.manage'); if (guard) return guard;
        const network = offlineFailure<HouseholdSnapshot['memberships'][number]>(); if (network) return network;
        const target = state.memberships.find((member) => member.id === id);
        if (!target) return missing('メンバー');
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で権限が更新されています。', retryable: true, reason: 'VERSION' });
        const activeOwners = state.memberships.filter((member) => member.status === 'active' && member.role === 'owner');
        if (target.role === 'owner' && role !== 'owner' && activeOwners.length === 1) return fail({ code: 'FORBIDDEN', message: '管理者は1人以上必要です。先に別のメンバーを管理者に変更してください。', retryable: false, reason: 'OWNER_REQUIRED' });
        target.role = role; target.version += 1; permissionRevision += 1;
        return ok(structuredClone(target));
      },
      async createInvite(role) {
        await delay();
        const guard = requireCapability<HouseholdInvite>('household.invites.manage'); if (guard) return guard;
        const network = offlineFailure<HouseholdInvite>(); if (network) return network;
        const invite = { id: nextId('invite'), householdId: state.household.id, role, token: `FAMILY-2026-${String(sequence).padStart(4, '0')}-ONE-TIME`, expiresAt: '2026-10-01T07:45:00+09:00', remainingUses: 1 } as const;
        invites.push(invite);
        return ok(structuredClone(invite));
      },
      async listInvites() { await delay(); const guard = requireCapability<HouseholdInvite[]>('household.invites.manage'); return guard ?? ok(structuredClone(invites)); },
      async revokeInvite(id) {
        await delay(); const guard = requireCapability<HouseholdInvite>('household.invites.manage'); if (guard) return guard;
        const network = offlineFailure<HouseholdInvite>(); if (network) return network;
        const invite = invites.find((item) => item.id === id); if (!invite) return missing('招待');
        invite.revokedAt = '2026-09-30T07:50:00+09:00'; invite.remainingUses = 0; return ok(structuredClone(invite));
      },
      async getPermissionOverrides(membershipId) {
        await delay(); const guard = requireCapability<PermissionOverride[]>('household.members.manage');
        return guard ?? ok(structuredClone(permissionOverrides.filter((item) => item.membershipId === membershipId)));
      },
      async updatePermissionOverrides(membershipId, overrides, expectedPermissionRevision) {
        await delay(); const guard = requireCapability<HouseholdSnapshot>('household.members.manage'); if (guard) return guard;
        const network = offlineFailure<HouseholdSnapshot>(); if (network) return network;
        if (expectedPermissionRevision !== permissionRevision) return fail({ code: 'CONFLICT', message: '別の端末で権限が変更されました。最新の内容を確認してください。', retryable: true, reason: 'PERMISSION_REVISION' });
        const member = state.memberships.find((item) => item.id === membershipId); if (!member) return missing('メンバー');
        const ceiling = new Set(capabilityCeilingFor(member.role));
        if (overrides.some((item) => item.membershipId !== membershipId || (item.effect === 'allow' && !ceiling.has(item.capability)))) return fail({ code: 'INVALID_INPUT', message: 'この役割で利用できない機能は、個別に許可できません。必要な場合は役割を変更してください。', retryable: false });
        permissionOverrides = [...permissionOverrides.filter((item) => item.membershipId !== membershipId), ...structuredClone(overrides)];
        permissionRevision += 1; return ok(project());
      },
      async resetPermissionOverrides(membershipId, expectedPermissionRevision) {
        await delay(); const guard = requireCapability<HouseholdSnapshot>('household.members.manage'); if (guard) return guard;
        if (expectedPermissionRevision !== permissionRevision) return fail({ code: 'CONFLICT', message: '別の端末で権限が変更されました。最新の内容を確認してください。', retryable: true, reason: 'PERMISSION_REVISION' });
        if (!state.memberships.some((item) => item.id === membershipId)) return missing('メンバー');
        permissionOverrides = permissionOverrides.filter((item) => item.membershipId !== membershipId); permissionRevision += 1; return ok(project());
      },
      async getPrivacySettings() { await delay(); return ok(structuredClone(privacy)); },
      async savePrivacySettings(settings) {
        await delay();
        const parsed = privacySettingsSchema.safeParse(settings);
        if (!parsed.success) return invalid(parsed.error.issues);
        const next = parsed.data;
        const previous = privacy.placeLookupConsent;
        // 同意の日時は利用者の端末ではなく受け付けた側の時計で記録する。
        const placeLookupConsent = next.placeLookupConsent
          ? (previous?.noticeVersion === next.placeLookupConsent.noticeVersion ? previous : { noticeVersion: next.placeLookupConsent.noticeVersion, grantedAt: '2026-09-30T07:45:00+09:00' })
          : null;
        privacy = { ...next, placeLookupConsent };
        return ok(structuredClone(privacy));
      },
    },
    events: {
      async createEvent(input, context) {
        await delay();
        const revision = permissionConflict<CalendarEvent>(context); if (revision) return revision;
        const guard = requireCapability<CalendarEvent>('event.create'); if (guard) return guard;
        const network = offlineFailure<CalendarEvent>(); if (network) return network;
        const event: CalendarEvent = {
          id: nextId('event'), householdId: state.household.id, ownerMembershipId: viewer().membershipId,
          title: input.title, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone,
          participantMembershipIds: input.participantMembershipIds, recurrence: input.recurrence as CalendarEvent['recurrence'], location: input.location, weatherSensitive: input.weatherSensitive, version: 1,
          visibility: { audience: 'participants', creatorMembershipId: viewer().membershipId, selectedMembershipIds: [] },
        };
        state.events = [...state.events, event];
        return ok(structuredClone(event));
      },
      async updateEvent(id, _scope, input, expectedVersion, context) {
        await delay();
        const revision = permissionConflict<CalendarEvent>(context); if (revision) return revision;
        const target = state.events.find((event) => event.id === id);
        if (!target) return missing('予定');
        const decision = canMutateOwnedResource(viewer(), 'event.update', target.ownerMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<CalendarEvent>(); if (network) return network;
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で予定が更新されています。', retryable: true, reason: 'VERSION' });
        Object.assign(target, input); target.version += 1;
        return ok(structuredClone(target));
      },
      async deleteEvent(id, _scope, expectedVersion) {
        await delay();
        const target = state.events.find((event) => event.id === id);
        if (!target) return missing('予定');
        const decision = canMutateOwnedResource(viewer(), 'event.delete', target.ownerMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<void>(); if (network) return network;
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で予定が更新されています。', retryable: true, reason: 'VERSION' });
        target.deletedAt = '2026-09-30T07:50:00+09:00'; archivedEvents.set(id, structuredClone(target));
        return ok(undefined);
      },
      async restoreEvent(id) {
        await delay(); const target = state.events.find((item) => item.id === id) ?? archivedEvents.get(id); if (!target) return missing('予定');
        const decision = canMutateOwnedResource(viewer(), 'event.update', target.ownerMembershipId); if (!decision.allowed) return denied(decision);
        delete target.deletedAt; target.version += 1; archivedEvents.delete(id); return ok(structuredClone(target));
      },
    },
    todos: {
      async createTodo(input, context) {
        await delay();
        const revision = permissionConflict<Todo>(context); if (revision) return revision;
        const guard = requireCapability<Todo>('task.create'); if (guard) return guard;
        const network = offlineFailure<Todo>(); if (network) return network;
        const todo: Todo = { id: nextId('todo'), householdId: state.household.id, title: input.title, dueAt: input.dueAt, status: 'open', assigneeMembershipId: input.assigneeMembershipId, reviewerMembershipId: input.reviewerMembershipId, creatorMembershipId: viewer().membershipId, version: 1, visibility: { audience: 'participants', creatorMembershipId: viewer().membershipId, selectedMembershipIds: [] } };
        state.todos = [todo, ...state.todos];
        return ok(structuredClone(todo));
      },
      async updateTodoStatus(id, status, expectedVersion) {
        await delay();
        const target = state.todos.find((todo) => todo.id === id);
        if (!target) return missing('タスク');
        const decision = authorize(viewer(), 'task.transition'); if (!decision.allowed) return denied(decision);
        if (![target.creatorMembershipId, target.assigneeMembershipId, target.reviewerMembershipId].includes(viewer().membershipId) && !['owner','adult'].includes(viewer().role)) return denied({ allowed: false, reason: 'SCOPE_DENIED' });
        const network = offlineFailure<Todo>(); if (network) return network;
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で更新されています。現在の内容を確認してください。', retryable: true, reason: 'VERSION' });
        target.status = status; target.version += 1;
        return ok(structuredClone(target));
      },
      async updateTodo(id, _scope, input, expectedVersion, context) {
        await delay();
        const revision = permissionConflict<Todo>(context); if (revision) return revision;
        const target = state.todos.find((todo) => todo.id === id);
        if (!target) return missing('タスク');
        const decision = canMutateOwnedResource(viewer(), 'task.update', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<Todo>(); if (network) return network;
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で更新されています。現在の内容を確認してください。', retryable: true, reason: 'VERSION' });
        Object.assign(target, input); target.version += 1;
        return ok(structuredClone(target));
      },
      async deleteTodo(id, expectedVersion) {
        await delay(); const target = state.todos.find((item) => item.id === id); if (!target) return missing('タスク');
        const decision = canMutateOwnedResource(viewer(), 'task.delete', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<void>(); if (network) return network;
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末で更新されています。', retryable: true, reason: 'VERSION' });
        target.deletedAt = '2026-09-30T07:50:00+09:00'; archivedTodos.set(id, structuredClone(target)); return ok(undefined);
      },
      async restoreTodo(id) {
        await delay(); const target = state.todos.find((item) => item.id === id) ?? archivedTodos.get(id); if (!target) return missing('タスク');
        const decision = canMutateOwnedResource(viewer(), 'task.update', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
        delete target.deletedAt; target.version += 1; archivedTodos.delete(id); return ok(structuredClone(target));
      },
    },
    memos: {
      async createMemo(input, context) {
        await delay();
        const revision = permissionConflict<Memo>(context); if (revision) return revision;
        const guard = requireCapability<Memo>('memo.create'); if (guard) return guard;
        const placeGuard = placeWriteGuard<Memo>(input.place); if (placeGuard) return placeGuard;
        const network = offlineFailure<Memo>(); if (network) return network;
        const parsed = memoInputSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        const { place, ...fields } = parsed.data;
        const memo: Memo = { id: nextId('memo'), householdId: state.household.id, ...fields, ...(place ? { place } : {}), updatedAt: '2026-09-30T07:45:00+09:00', authorMembershipId: viewer().membershipId, attachments: [], visibility: { audience: 'creator', creatorMembershipId: viewer().membershipId, selectedMembershipIds: [] }, version: 1 };
        state.memos = [memo, ...state.memos];
        return ok(visible(memo));
      },
      async updateMemo(id, input, expectedVersion, context) {
        await delay(); const target = state.memos.find((item) => item.id === id); if (!target) return missing('メモ');
        const revision = permissionConflict<Memo>(context); if (revision) return revision;
        const decision = canMutateOwnedResource(viewer(), 'memo.update', target.authorMembershipId); if (!decision.allowed) return denied(decision);
        const placeGuard = placeWriteGuard<Memo>(input.place); if (placeGuard) return placeGuard;
        const network = offlineFailure<Memo>(); if (network) return network;
        if (target.version !== expectedVersion) return fail({ code: 'CONFLICT', message: '別の端末でメモが更新されています。', retryable: true, reason: 'VERSION' });
        const parsed = memoInputSchema.partial().safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        const { place, ...fields } = parsed.data;
        Object.assign(target, fields);
        if (place === null) delete target.place;
        else if (place) target.place = place;
        target.version += 1; target.updatedAt = '2026-09-30T07:50:00+09:00'; return ok(visible(target));
      },
      async uploadAttachment(memoId, file) {
        await delay(260);
        const target = state.memos.find((memo) => memo.id === memoId);
        if (!target) return missing('メモ');
        const decision = canMutateOwnedResource(viewer(), 'memo.attach', target.authorMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<Memo>(); if (network) return network;
        if (file.size > 10_000_000 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
          return fail({ code: 'ATTACHMENT_REJECTED', message: '形式またはサイズが許可範囲外です。PDF・JPEG・PNG、10MB以内にしてください。', retryable: false });
        }
        const memo: Memo = structuredClone(target);
        memo.attachments.push({ id: `attachment-${Date.now()}`, memoId, originalName: file.name, mimeType: file.type, byteSize: file.size, status: 'quarantined', statusMessage: 'ファイルを確認しています。完了するまで開けません' });
        Object.assign(target, memo);
        return ok(visible(memo));
      },
      async deleteMemo(id) {
        await delay(); const target = state.memos.find((item) => item.id === id); if (!target) return missing('メモ');
        const decision = canMutateOwnedResource(viewer(), 'memo.delete', target.authorMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<void>(); if (network) return network;
        target.deletedAt = '2026-09-30T07:50:00+09:00'; archivedMemos.set(id, structuredClone(target)); return ok(undefined);
      },
      async restoreMemo(id) {
        await delay(); const target = state.memos.find((item) => item.id === id) ?? archivedMemos.get(id); if (!target) return missing('メモ');
        const decision = canMutateOwnedResource(viewer(), 'memo.update', target.authorMembershipId); if (!decision.allowed) return denied(decision);
        delete target.deletedAt; archivedMemos.delete(id); return ok(visible(target));
      },
    },
    expenses: {
      async createExpense(input) {
        await delay();
        const guard = requireCapability<Expense>('expense.create'); if (guard) return guard;
        const placeGuard = placeWriteGuard<Expense>(input.place); if (placeGuard) return placeGuard;
        const network = offlineFailure<Expense>(); if (network) return network;
        const parsed = expenseInputSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        const data = parsed.data;
        const base = Math.floor(data.amountJpy / data.shareMembershipIds.length);
        let remainder = data.amountJpy - base * data.shareMembershipIds.length;
        const expense: Expense = {
          id: `expense-${Date.now()}`, householdId: state.household.id, title: data.title, amountJpy: data.amountJpy,
          incurredOn: data.incurredOn as Expense['incurredOn'], payerMembershipId: data.payerMembershipId, category: 'other', settlements: [],
          shares: data.shareMembershipIds.map((membershipId) => ({ membershipId, amountJpy: base + (remainder-- > 0 ? 1 : 0), settledJpy: membershipId === data.payerMembershipId ? base : 0 })),
          ...(data.place ? { place: data.place } : {}),
        };
        state.expenses = [expense, ...state.expenses];
        return ok(visible(expense));
      },
      async recordSettlement(expenseId, amountJpy) {
        await delay();
        const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
        const network = offlineFailure<Expense>(); if (network) return network;
        const target = state.expenses.find((expense) => expense.id === expenseId);
        if (!target || !Number.isInteger(amountJpy) || amountJpy <= 0) return fail({ code: 'INVALID_INPUT', message: '精算額を確認してください。', retryable: false });
        const share = target.shares.find((item) => item.membershipId !== target.payerMembershipId && item.settledJpy < item.amountJpy);
        if (!share) return fail({ code: 'CONFLICT', message: 'すでに精算済みです。', retryable: false });
        const applied = Math.min(amountJpy, share.amountJpy - share.settledJpy);
        share.settledJpy += applied;
        target.settlements.push({ id: `settlement-${Date.now()}`, amountJpy: applied, fromMembershipId: share.membershipId, toMembershipId: target.payerMembershipId, recordedAt: '2026-09-30T07:45:00+09:00' });
        return ok(visible(target));
      },
      async reverseSettlement(expenseId, settlementId) {
        await delay(); const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
        const target = state.expenses.find((item) => item.id === expenseId); if (!target) return missing('支出');
        const settlement = target.settlements.find((item) => item.id === settlementId && !item.reversedAt); if (!settlement) return missing('精算記録');
        const share = target.shares.find((item) => item.membershipId === settlement.fromMembershipId); if (!share) return missing('負担記録');
        settlement.reversedAt = '2026-09-30T07:50:00+09:00'; share.settledJpy = Math.max(0, share.settledJpy - settlement.amountJpy);
        target.settlements.push({ id: nextId('settlement-reversal'), amountJpy: -settlement.amountJpy, fromMembershipId: settlement.toMembershipId, toMembershipId: settlement.fromMembershipId, recordedAt: '2026-09-30T07:50:00+09:00', reversalOfSettlementId: settlement.id });
        return ok(visible(target));
      },
    },
    resources: {
      async search(query) {
        await delay(60);
        const snapshot = project();
        const normalized = query.trim().toLowerCase();
        if (!normalized) return ok([]);
        const results = [
          ...snapshot.events.map((item) => ({ kind: '予定', id: item.id, label: item.title, destination: `/calendar/${item.id}` })),
          ...snapshot.todos.map((item) => ({ kind: 'タスク', id: item.id, label: item.title, destination: `/tasks/${item.id}` })),
          ...snapshot.memos.map((item) => ({ kind: 'メモ', id: item.id, label: item.title, destination: `/notes/${item.id}` })),
          ...snapshot.resources.map((item) => ({ kind: '関連リンク', id: item.id, label: item.label, destination: '/settings/resources' })),
        ].filter((item) => item.label.toLowerCase().includes(normalized));
        return ok(results.slice(0, 8));
      },
    },
    context: {
      async getContext() { await delay(60); return ok(structuredClone(state.context)); },
    },
    notifications: {
      async list() { await delay(50); const guard = requireCapability<HouseholdNotification[]>('notification.manage'); return guard ?? ok(structuredClone(notifications)); },
      async markRead(id) {
        await delay(50); const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = notifications.find((item) => item.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '通知が見つかりません。', retryable: false });
        target.read = true; return ok(structuredClone(target));
      },
      async snooze(id, minutes) {
        await delay(); const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = notifications.find((item) => item.id === id);
        if (!target || minutes !== 30) return fail({ code: 'INVALID_INPUT', message: '通知を延期できません。', retryable: false });
        target.status = 'snoozed'; target.remindAt = '2026-09-30T18:00:00+09:00'; return ok(structuredClone(target));
      },
      async stop(id) {
        await delay(); const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = notifications.find((item) => item.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '通知が見つかりません。', retryable: false });
        target.status = 'stopped'; return ok(structuredClone(target));
      },
      async resume(id) {
        await delay(); const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = notifications.find((item) => item.id === id);
        if (!target) return missing('通知'); target.status = 'active'; return ok(structuredClone(target));
      },
      async getPreferences() { await delay(50); return ok(structuredClone(notificationPreferences)); },
      async updatePreferences(input) { await delay(); notificationPreferences = { ...notificationPreferences, ...input }; return ok(structuredClone(notificationPreferences)); },
    },
    credentials: {
      async create() { await delay(); return ok({ id: nextId('mock-credential'), demo: true }); },
    },
  };
}
