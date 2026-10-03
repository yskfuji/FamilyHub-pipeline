import type { FamilyHubGateway } from './gateway';
import { baseInvites, baseNotificationPreferences, baseNotifications, basePrivacySettings, baseSecurityOverview, baseSnapshot } from './fixtures';
import { eventFieldsSchema, expenseInputSchema, expenseUpdateSchema, householdProfileSchema, isEventTimeRangeValid, memoInputSchema, passwordSchema, privacySettingsSchema, todoInputSchema } from '../domain/schemas';
import { addDateKeyDays, dateKeyFromRfc3339, toJstRfc3339 } from '../domain/calendarDate';
import { hasActiveSettlement, splitShares } from '../domain/ledger';
import { deriveInsights } from '../domain/insights';
import { aggregatePlaces } from '../domain/places';
import { isOccurrence, nextOccurrenceAfter, occurrenceStartsAt, remainderRule, withUntil } from '../domain/recurrence';
import { authorize, authorizeVisibleResource, canMutateOwnedResource, capabilitiesFor, capabilityCeilingFor, projectSnapshotForViewer, redactPlace } from '../authz/policy';
import type { Authenticator, AuthorizationDecision, CalendarEvent, Capability, Expense, GatewayError, HouseholdInvite, HouseholdNotification, HouseholdSnapshot, Id, Insight, IsoDate, Memo, MutationContext, NotificationPreferences, PermissionOverride, PlaceRef, PrivacySettings, Result, Scenario, SecurityOverview, Todo } from '../domain/types';
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
  const invites: HouseholdInvite[] = structuredClone(baseInvites);
  const archivedEvents = new Map<Id, CalendarEvent>();
  const archivedTodos = new Map<Id, Todo>();
  const archivedMemos = new Map<Id, Memo>();
  const archivedExpenses = new Map<Id, Expense>();
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-mock-${++sequence}`;
  // 確認用データの時計。操作のたびに1分進め、記録の前後関係（履歴の並び）を再現できるようにする。
  let clockTick = 0;
  const now = () => toJstRfc3339(new Date(Date.parse('2026-09-30T07:45:00+09:00') + (clockTick++) * 60_000));
  const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const withinRestoreWindow = (deletedAt?: string) => !deletedAt || Date.parse(now()) - Date.parse(deletedAt) <= RESTORE_WINDOW_MS;
  let passkeyChallenge: string | null = null;
  const defaultVisibility = () => ({ audience: privacy.defaultAudience, creatorMembershipId: viewer().membershipId, selectedMembershipIds: [] as Id[] });
  const conflict = <T,>(label: string): Result<T> => fail({ code: 'CONFLICT', message: `別の端末で${label}が更新されています。現在の内容を確認してください。`, retryable: true, reason: 'VERSION' });
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
      async beginPasskey() { await delay(); passkeyChallenge = nextId('passkey-challenge'); return ok({ challengeId: passkeyChallenge, publicKey: null }); },
      async finishPasskey(challengeId, assertion) {
        await delay();
        // 確認用データでは端末の本人確認を模擬する。実際の検証（署名・origin・RP ID）は API 側の責務。
        if (!passkeyChallenge || challengeId !== passkeyChallenge || !assertion) return fail({ code: 'UNAUTHENTICATED', message: 'パスキーで本人確認できませんでした。もう一度お試しください。', retryable: true });
        passkeyChallenge = null;
        return ok({ userId: state.user.id });
      },
      async signInWithPassword(email, password) {
        await delay();
        if (!email.includes('@') || password.length < 15) return fail({ code: 'INVALID_INPUT', message: '入力内容を確認してください。', retryable: false });
        return ok({ userId: state.user.id });
      },
      async signOut() { await delay(); return ok(undefined); },
      async getSecurityOverview() { await delay(); const guard = requireCapability<SecurityOverview>('settings.own'); return guard ?? ok(structuredClone(security)); },
      async beginPasskeyRegistration() { await delay(); const guard = requireCapability<{ challengeId: Id; publicKey: null }>('settings.own'); return guard ?? ok({ challengeId: nextId('challenge'), publicKey: null }); },
      async finishPasskeyRegistration(challengeId, credential) {
        await delay();
        const guard = requireCapability<Authenticator>('settings.own'); if (guard) return guard;
        if (!challengeId || !credential) return fail({ code: 'INVALID_INPUT', message: 'パスキー登録を完了できませんでした。', retryable: true });
        const authenticator: Authenticator = { id: nextId('authenticator'), label: 'この端末（デモ）', createdAt: now(), kind: 'passkey', demo: true };
        security.authenticators.push(authenticator);
        return ok(structuredClone(authenticator));
      },
      async changePassword(currentPassword, newPassword) {
        await delay();
        const guard = requireCapability<void>('settings.own'); if (guard) return guard;
        if (!passwordSchema.safeParse(currentPassword).success) return fail({ code: 'UNAUTHENTICATED', message: '現在のパスワードを確認してください。', retryable: false });
        const parsed = passwordSchema.safeParse(newPassword);
        if (!parsed.success) return fail({ code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? '新しいパスワードを確認してください。', retryable: false });
        return ok(undefined);
      },
      async revokeSession(sessionId) {
        await delay();
        const guard = requireCapability<void>('settings.own'); if (guard) return guard;
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
        if (scenario === 'weather') snapshot.context.weather = { location: snapshot.context.weather.location, condition: 'storm', temperatureC: 20, precipitationPercent: 95, alert: '雷を伴う激しい雨のおそれ。屋外予定を確認してください' };
        return ok(snapshot);
      },
      async acceptInvite(code) {
        await delay();
        // 期限切れ・使用済み・取り消し・存在しないコードを区別しない（推測を防ぐ）。
        const invite = invites.find((item) => item.token === code.trim());
        const usable = invite && !invite.revokedAt && invite.remainingUses > 0 && Date.parse(invite.expiresAt) > Date.parse(now());
        if (!invite || !usable) return fail({ code: 'UNAUTHENTICATED', message: '招待コードが正しくないか、有効期限が切れています。招待した人に新しいコードを依頼してください。', retryable: false });
        invite.remainingUses -= 1;
        return ok({ householdId: state.household.id });
      },
      async updateProfile(input) {
        await delay();
        const guard = requireCapability<HouseholdSnapshot['household']>('household.members.manage'); if (guard) return guard;
        const network = offlineFailure<HouseholdSnapshot['household']>(); if (network) return network;
        const parsed = householdProfileSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        state.household.name = parsed.data.name;
        return ok(structuredClone(state.household));
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
        const invite = { id: nextId('invite'), householdId: state.household.id, role, token: `FAMILY-2026-${String(sequence).padStart(4, '0')}-ONE-TIME`, expiresAt: toJstRfc3339(new Date(Date.parse(now()) + 24 * 60 * 60 * 1000)), remainingUses: 1 } as const;
        invites.push(invite);
        return ok(structuredClone(invite));
      },
      // 招待コードは作成時の応答でだけ返す。一覧には含めない（画面の共有や記録から漏れないようにする）。
      async listInvites() { await delay(); const guard = requireCapability<HouseholdInvite[]>('household.invites.manage'); return guard ?? ok(invites.map((invite) => { const listed = structuredClone(invite); delete listed.token; return listed; })); },
      async revokeInvite(id) {
        await delay(); const guard = requireCapability<HouseholdInvite>('household.invites.manage'); if (guard) return guard;
        const network = offlineFailure<HouseholdInvite>(); if (network) return network;
        const invite = invites.find((item) => item.id === id); if (!invite) return missing('招待');
        invite.revokedAt = now(); invite.remainingUses = 0; return ok(structuredClone(invite));
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
      async getPrivacySettings() { await delay(); const guard = requireCapability<PrivacySettings>('settings.own'); return guard ?? ok(structuredClone(privacy)); },
      async savePrivacySettings(settings) {
        await delay();
        const guard = requireCapability<PrivacySettings>('settings.own'); if (guard) return guard;
        const parsed = privacySettingsSchema.safeParse(settings);
        if (!parsed.success) return invalid(parsed.error.issues);
        const next = parsed.data;
        const previous = privacy.placeLookupConsent;
        // 同意の日時は利用者の端末ではなく受け付けた側の時計で記録する。
        const placeLookupConsent = next.placeLookupConsent
          ? (previous?.noticeVersion === next.placeLookupConsent.noticeVersion ? previous : { noticeVersion: next.placeLookupConsent.noticeVersion, grantedAt: now() })
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
        const parsed = eventFieldsSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        if (!isEventTimeRangeValid(parsed.data.startsAt, parsed.data.endsAt)) return invalid([{ message: '終了日時は開始日時より後にしてください。' }]);
        const event: CalendarEvent = {
          ...parsed.data, recurrence: parsed.data.recurrence as CalendarEvent['recurrence'],
          id: nextId('event'), householdId: state.household.id, ownerMembershipId: viewer().membershipId, version: 1, visibility: defaultVisibility(),
        };
        state.events = [...state.events, event];
        return ok(structuredClone(event));
      },
      async updateEvent(id, scope, input, expectedVersion, context, occurrenceDate) {
        await delay();
        const revision = permissionConflict<CalendarEvent>(context); if (revision) return revision;
        const target = state.events.find((event) => event.id === id && !event.deletedAt);
        if (!target) return missing('予定');
        const decision = canMutateOwnedResource(viewer(), 'event.update', target.ownerMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<CalendarEvent>(); if (network) return network;
        if (target.version !== expectedVersion) return conflict('予定');
        const parsed = eventFieldsSchema.partial().safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        const changes = parsed.data as Partial<CalendarEvent>;
        const seriesStart = dateKeyFromRfc3339(target.startsAt);
        const recurring = Boolean(target.recurrence) && scope !== 'series';
        if (recurring && (!occurrenceDate || !isOccurrence(seriesStart, target.recurrence!, occurrenceDate))) return invalid([{ message: '変更する回を確認してください。' }]);
        archivedEvents.set(target.id, structuredClone(target));
        if (!recurring || (scope === 'future' && occurrenceDate === seriesStart)) {
          const next = { ...target, ...changes };
          if (!isEventTimeRangeValid(next.startsAt, next.endsAt)) return invalid([{ message: '終了日時は開始日時より後にしてください。' }]);
          Object.assign(target, changes); target.version += 1;
          return ok(structuredClone(target));
        }
        const occurrence = occurrenceDate as IsoDate;
        const base: CalendarEvent = { ...structuredClone(target), startsAt: occurrenceStartsAt(target.startsAt, occurrence), endsAt: occurrenceStartsAt(target.endsAt, addDateKeyDays(occurrence, Number(dateKeyFromRfc3339(target.endsAt) > seriesStart)) as IsoDate) };
        const copy: CalendarEvent = { ...base, ...changes, id: nextId('event'), version: 1 };
        if (!isEventTimeRangeValid(copy.startsAt, copy.endsAt)) return invalid([{ message: '終了日時は開始日時より後にしてください。' }]);
        if (scope === 'this') {
          delete copy.recurrence;
          target.recurrence = { ...target.recurrence!, exceptions: [...target.recurrence!.exceptions, occurrence] };
        } else {
          copy.recurrence = { ...target.recurrence!, rrule: remainderRule(seriesStart, target.recurrence!, occurrence), exceptions: target.recurrence!.exceptions.filter((date) => date >= occurrence) };
          target.recurrence = { ...target.recurrence!, rrule: withUntil(target.recurrence!.rrule, addDateKeyDays(occurrence, -1)), exceptions: target.recurrence!.exceptions.filter((date) => date < occurrence) };
        }
        target.version += 1;
        state.events = [...state.events, copy];
        return ok(structuredClone(copy));
      },
      async deleteEvent(id, scope, expectedVersion, occurrenceDate) {
        await delay();
        const target = state.events.find((event) => event.id === id && !event.deletedAt);
        if (!target) return missing('予定');
        const decision = canMutateOwnedResource(viewer(), 'event.delete', target.ownerMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<void>(); if (network) return network;
        if (target.version !== expectedVersion) return conflict('予定');
        const seriesStart = dateKeyFromRfc3339(target.startsAt);
        const partial = Boolean(target.recurrence) && scope !== 'series' && !(scope === 'future' && occurrenceDate === seriesStart);
        if (partial && (!occurrenceDate || !isOccurrence(seriesStart, target.recurrence!, occurrenceDate))) return invalid([{ message: '削除する回を確認してください。' }]);
        archivedEvents.set(id, structuredClone(target));
        if (!partial) target.deletedAt = now();
        else if (scope === 'this') target.recurrence = { ...target.recurrence!, exceptions: [...target.recurrence!.exceptions, occurrenceDate as IsoDate] };
        else target.recurrence = { ...target.recurrence!, rrule: withUntil(target.recurrence!.rrule, addDateKeyDays(occurrenceDate!, -1)) };
        target.version += 1;
        return ok(undefined);
      },
      async restoreEvent(id) {
        await delay();
        const archived = archivedEvents.get(id); const target = state.events.find((item) => item.id === id);
        if (!archived || !target) return missing('予定');
        const decision = canMutateOwnedResource(viewer(), 'event.update', target.ownerMembershipId); if (!decision.allowed) return denied(decision);
        if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
        // 削除・回の除外・シリーズの短縮のどれでも、操作前の状態へ戻す。
        Object.assign(target, { ...archived, version: target.version + 1 });
        if (!archived.deletedAt) delete target.deletedAt;
        archivedEvents.delete(id);
        return ok(structuredClone(target));
      },
    },
    todos: {
      async createTodo(input, context) {
        await delay();
        const revision = permissionConflict<Todo>(context); if (revision) return revision;
        const guard = requireCapability<Todo>('task.create'); if (guard) return guard;
        const network = offlineFailure<Todo>(); if (network) return network;
        const parsed = todoInputSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        const todo: Todo = { ...parsed.data, id: nextId('todo'), householdId: state.household.id, status: 'open', creatorMembershipId: viewer().membershipId, version: 1, visibility: defaultVisibility() };
        state.todos = [todo, ...state.todos];
        return ok(structuredClone(todo));
      },
      async updateTodoStatus(id, status, expectedVersion) {
        await delay();
        const target = state.todos.find((todo) => todo.id === id && !todo.deletedAt);
        if (!target) return missing('タスク');
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
      async updateTodo(id, scope, input, expectedVersion, context) {
        await delay();
        const revision = permissionConflict<Todo>(context); if (revision) return revision;
        const target = state.todos.find((todo) => todo.id === id && !todo.deletedAt);
        if (!target) return missing('タスク');
        const decision = canMutateOwnedResource(viewer(), 'task.update', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<Todo>(); if (network) return network;
        if (target.version !== expectedVersion) return conflict('タスク');
        const parsed = todoInputSchema.partial().safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        if (scope === 'this' && target.recurrence && target.dueAt) {
          // 今回だけ変える: 今回分を切り出し、シリーズは次の回へ進める。
          const next = nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt));
          const single: Todo = { ...structuredClone(target), ...parsed.data, id: nextId('todo'), version: 1 };
          delete single.recurrence;
          archivedTodos.set(target.id, structuredClone(target));
          if (next) { target.dueAt = occurrenceStartsAt(target.dueAt, next); target.version += 1; } else target.deletedAt = now();
          state.todos = [single, ...state.todos];
          return ok(structuredClone(single));
        }
        Object.assign(target, parsed.data); target.version += 1;
        return ok(structuredClone(target));
      },
      async deleteTodo(id, expectedVersion, scope = 'series') {
        await delay(); const target = state.todos.find((item) => item.id === id && !item.deletedAt); if (!target) return missing('タスク');
        const decision = canMutateOwnedResource(viewer(), 'task.delete', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<void>(); if (network) return network;
        if (target.version !== expectedVersion) return conflict('タスク');
        archivedTodos.set(id, structuredClone(target));
        const next = scope === 'this' && target.recurrence && target.dueAt ? nextOccurrenceAfter(dateKeyFromRfc3339(target.dueAt), target.recurrence, dateKeyFromRfc3339(target.dueAt)) : null;
        if (next && target.dueAt) { target.dueAt = occurrenceStartsAt(target.dueAt, next); target.version += 1; }
        else target.deletedAt = now();
        return ok(undefined);
      },
      async restoreTodo(id) {
        await delay();
        const archived = archivedTodos.get(id); const target = state.todos.find((item) => item.id === id);
        if (!archived || !target) return missing('タスク');
        const decision = canMutateOwnedResource(viewer(), 'task.update', target.creatorMembershipId); if (!decision.allowed) return denied(decision);
        if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
        Object.assign(target, { ...archived, version: target.version + 1 });
        if (!archived.deletedAt) delete target.deletedAt;
        archivedTodos.delete(id);
        return ok(structuredClone(target));
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
        const memo: Memo = { id: nextId('memo'), householdId: state.household.id, ...fields, ...(place ? { place } : {}), updatedAt: now(), authorMembershipId: viewer().membershipId, attachments: [], visibility: defaultVisibility(), version: 1 };
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
        target.version += 1; target.updatedAt = now(); return ok(visible(target));
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
        const attachmentId = nextId('attachment');
        memo.attachments.push({ id: attachmentId, memoId, originalName: file.name, mimeType: file.type, byteSize: file.size, status: 'quarantined', statusMessage: 'ファイルを確認しています。完了するまで開けません' });
        Object.assign(target, memo);
        // 確認用データでは、数秒後に確認が終わった状態へ進める（実際はウイルス検査などの結果を待つ）。
        window.setTimeout(() => {
          const attachment = target.attachments.find((item) => item.id === attachmentId);
          if (attachment?.status === 'quarantined') Object.assign(attachment, { status: 'clean', statusMessage: '確認が終わり、開ける状態です' });
        }, 3000);
        return ok(visible(memo));
      },
      async getAttachmentLink(memoId, attachmentId) {
        await delay();
        const target = state.memos.find((memo) => memo.id === memoId && !memo.deletedAt);
        if (!target) return missing('メモ');
        const decision = authorizeVisibleResource(viewer(), 'memo.read', target.visibility, [target.authorMembershipId]); if (!decision.allowed) return missing('メモ');
        const attachment = target.attachments.find((item) => item.id === attachmentId);
        if (!attachment) return missing('添付ファイル');
        if (attachment.status !== 'clean') return fail({ code: 'ATTACHMENT_REJECTED', message: '確認が終わるまで、このファイルは開けません。', retryable: true });
        return fail({ code: 'NOT_FOUND', message: 'この確認用データには原本のファイルが含まれていないため開けません。実際の環境では、確認済みのファイルを期限付きのリンクで開きます。', retryable: false });
      },
      async deleteMemo(id) {
        await delay(); const target = state.memos.find((item) => item.id === id); if (!target) return missing('メモ');
        const decision = canMutateOwnedResource(viewer(), 'memo.delete', target.authorMembershipId); if (!decision.allowed) return denied(decision);
        const network = offlineFailure<void>(); if (network) return network;
        target.deletedAt = now(); archivedMemos.set(id, structuredClone(target)); return ok(undefined);
      },
      async restoreMemo(id) {
        await delay(); const target = state.memos.find((item) => item.id === id) ?? archivedMemos.get(id); if (!target) return missing('メモ');
        const decision = canMutateOwnedResource(viewer(), 'memo.update', target.authorMembershipId); if (!decision.allowed) return denied(decision);
        if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
        delete target.deletedAt; target.version += 1; archivedMemos.delete(id); return ok(visible(target));
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
        const expense: Expense = {
          id: nextId('expense'), householdId: state.household.id, title: data.title, amountJpy: data.amountJpy,
          incurredOn: data.incurredOn as Expense['incurredOn'], payerMembershipId: data.payerMembershipId, category: data.category, settlements: [],
          shares: splitShares(data.amountJpy, data.payerMembershipId, data.shareMembershipIds), version: 1,
          ...(data.note ? { note: data.note } : {}), ...(data.place ? { place: data.place } : {}),
        };
        state.expenses = [expense, ...state.expenses];
        return ok(visible(expense));
      },
      async updateExpense(id, input, expectedVersion) {
        await delay();
        const guard = requireCapability<Expense>('expense.create'); if (guard) return guard;
        const target = state.expenses.find((item) => item.id === id && !item.deletedAt); if (!target) return missing('支出');
        const placeGuard = placeWriteGuard<Expense>(input.place); if (placeGuard) return placeGuard;
        const network = offlineFailure<Expense>(); if (network) return network;
        if (target.version !== expectedVersion) return conflict('支出');
        const parsed = expenseUpdateSchema.safeParse(input);
        if (!parsed.success) return invalid(parsed.error.issues);
        const { place, note, amountJpy, payerMembershipId, shareMembershipIds, ...rest } = parsed.data;
        const changesSplit = amountJpy !== undefined || payerMembershipId !== undefined || shareMembershipIds !== undefined;
        if (changesSplit && hasActiveSettlement(target)) return fail({ code: 'CONFLICT', message: '精算の記録があるため、金額・支払った人・負担する人は変更できません。先に精算を取り消してください。', retryable: false });
        Object.assign(target, rest);
        if (changesSplit) {
          target.amountJpy = amountJpy ?? target.amountJpy;
          target.payerMembershipId = payerMembershipId ?? target.payerMembershipId;
          target.shares = splitShares(target.amountJpy, target.payerMembershipId, shareMembershipIds ?? target.shares.map((share) => share.membershipId));
        }
        if (note === null) delete target.note; else if (note !== undefined) target.note = note;
        if (place === null) delete target.place; else if (place) target.place = place;
        target.version += 1;
        return ok(visible(target));
      },
      async deleteExpense(id, expectedVersion) {
        await delay();
        const guard = requireCapability<void>('expense.create'); if (guard) return guard;
        const target = state.expenses.find((item) => item.id === id && !item.deletedAt); if (!target) return missing('支出');
        const network = offlineFailure<void>(); if (network) return network;
        if (target.version !== expectedVersion) return conflict('支出');
        if (hasActiveSettlement(target)) return fail({ code: 'CONFLICT', message: '精算の記録がある支出は削除できません。先に精算を取り消してください。', retryable: false });
        target.deletedAt = now(); target.version += 1; archivedExpenses.set(id, structuredClone(target));
        return ok(undefined);
      },
      async restoreExpense(id) {
        await delay();
        const guard = requireCapability<Expense>('expense.create'); if (guard) return guard;
        const target = state.expenses.find((item) => item.id === id) ?? archivedExpenses.get(id); if (!target?.deletedAt) return missing('支出');
        if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
        delete target.deletedAt; target.version += 1; archivedExpenses.delete(id);
        return ok(visible(target));
      },
      async recordSettlement(expenseId, fromMembershipId, amountJpy) {
        await delay();
        const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
        const network = offlineFailure<Expense>(); if (network) return network;
        const target = state.expenses.find((expense) => expense.id === expenseId && !expense.deletedAt);
        if (!target) return missing('支出');
        if (!Number.isInteger(amountJpy) || amountJpy <= 0) return invalid([{ message: '精算額は1円以上の整数にしてください。' }]);
        const share = target.shares.find((item) => item.membershipId === fromMembershipId && item.membershipId !== target.payerMembershipId);
        if (!share) return invalid([{ message: '精算する人を確認してください。' }]);
        if (share.settledJpy >= share.amountJpy) return fail({ code: 'CONFLICT', message: 'すでに精算済みです。', retryable: false });
        const applied = Math.min(amountJpy, share.amountJpy - share.settledJpy);
        share.settledJpy += applied;
        target.settlements.push({ id: nextId('settlement'), amountJpy: applied, fromMembershipId: share.membershipId, toMembershipId: target.payerMembershipId, recordedAt: now() });
        target.version += 1;
        return ok(visible(target));
      },
      async reverseSettlement(expenseId, settlementId) {
        await delay(); const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
        const network = offlineFailure<Expense>(); if (network) return network;
        const target = state.expenses.find((item) => item.id === expenseId && !item.deletedAt); if (!target) return missing('支出');
        const settlement = target.settlements.find((item) => item.id === settlementId && item.amountJpy > 0 && !item.reversedAt); if (!settlement) return missing('精算記録');
        const share = target.shares.find((item) => item.membershipId === settlement.fromMembershipId); if (!share) return missing('負担記録');
        const at = now();
        settlement.reversedAt = at; share.settledJpy = Math.max(0, share.settledJpy - settlement.amountJpy);
        target.settlements.push({ id: nextId('settlement-reversal'), amountJpy: -settlement.amountJpy, fromMembershipId: settlement.toMembershipId, toMembershipId: settlement.fromMembershipId, recordedAt: at, reversalOfSettlementId: settlement.id });
        target.version += 1;
        return ok(visible(target));
      },
    },
    resources: {
      async search(query) {
        await delay(60);
        const snapshot = project();
        const normalized = query.trim().toLowerCase();
        if (!normalized) return ok([]);
        const has = (...values: Array<string | undefined>) => values.some((value) => value?.toLowerCase().includes(normalized));
        const results: Array<{ kind: 'event' | 'task' | 'memo' | 'expense' | 'place' | 'resource'; id: Id; label: string; detail?: string; destination: string }> = [
          ...snapshot.events.filter((item) => has(item.title, item.location, item.note)).map((item) => ({ kind: 'event' as const, id: item.id, label: item.title, detail: item.location, destination: `/calendar/${item.id}` })),
          ...snapshot.todos.filter((item) => has(item.title, item.note)).map((item) => ({ kind: 'task' as const, id: item.id, label: item.title, destination: `/tasks/${item.id}` })),
          ...snapshot.memos.filter((item) => has(item.title, item.body, item.ocrText, ...item.tags, item.place?.name)).map((item) => ({ kind: 'memo' as const, id: item.id, label: item.title, detail: item.tags.join(' / ') || undefined, destination: `/notes/${item.id}` })),
          ...snapshot.expenses.filter((item) => has(item.title, item.note, item.place?.name)).map((item) => ({ kind: 'expense' as const, id: item.id, label: item.title, detail: item.place?.name, destination: `/budget/${item.id}` })),
          ...aggregatePlaces(snapshot.expenses, snapshot.memos).filter((item) => has(item.place.name, item.place.address)).map((item) => ({ kind: 'place' as const, id: item.key, label: item.place.name, detail: item.place.address, destination: `/places/${item.key}` })),
          ...snapshot.resources.filter((item) => has(item.label)).map((item) => ({ kind: 'resource' as const, id: item.id, label: item.label, destination: `/settings/resources#${item.id}` })),
        ];
        return ok(results.slice(0, 12));
      },
    },
    insights: {
      async list() {
        await delay(60);
        const guard = requireCapability<Insight[]>('insight.read'); if (guard) return guard;
        return ok(deriveInsights(project()));
      },
    },
    notifications: {
      async list() {
        await delay(50); const guard = requireCapability<HouseholdNotification[]>('notification.manage'); if (guard) return guard;
        // 通知設定に従って出し分ける。夜間に当たる通知は翌朝7時に回す。
        const visibleNotifications = notifications
          .filter((item) => (item.kind === 'todoDue' ? notificationPreferences.todoDue : notificationPreferences.eventDeparture))
          .map((item) => {
            const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tokyo' }).format(new Date(item.remindAt)));
            if (!notificationPreferences.quietHours || (hour >= 7 && hour < 21)) return structuredClone(item);
            const day = dateKeyFromRfc3339(item.remindAt);
            return { ...structuredClone(item), remindAt: `${hour >= 21 ? addDateKeyDays(day, 1) : day}T07:00:00+09:00` };
          });
        return ok(visibleNotifications);
      },
      async markRead(id) {
        await delay(50); const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = notifications.find((item) => item.id === id);
        if (!target) return fail({ code: 'INVALID_INPUT', message: '通知が見つかりません。', retryable: false });
        target.read = true; return ok(structuredClone(target));
      },
      async snooze(id, minutes) {
        await delay(); const guard = requireCapability<HouseholdNotification>('notification.manage'); if (guard) return guard; const target = notifications.find((item) => item.id === id);
        if (!target || minutes !== 30) return fail({ code: 'INVALID_INPUT', message: '通知を延期できません。', retryable: false });
        target.status = 'snoozed'; target.remindAt = toJstRfc3339(new Date(Math.max(Date.parse(now()), Date.parse(target.remindAt)) + 30 * 60_000)); return ok(structuredClone(target));
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
      async getPreferences() { await delay(50); const guard = requireCapability<NotificationPreferences>('notification.manage'); return guard ?? ok(structuredClone(notificationPreferences)); },
      async updatePreferences(input) {
        await delay(); const guard = requireCapability<NotificationPreferences>('notification.manage'); if (guard) return guard;
        const allowed = ['todoDue', 'eventDeparture', 'quietHours'] as const;
        if (Object.entries(input).some(([key, value]) => !allowed.includes(key as typeof allowed[number]) || typeof value !== 'boolean')) return invalid([{ message: '通知の設定を確認してください。' }]);
        notificationPreferences = { ...notificationPreferences, ...input }; return ok(structuredClone(notificationPreferences));
      },
    },
    credentials: {
      async create() { await delay(); return ok({ id: nextId('mock-credential'), demo: true }); },
      // 確認用データでは端末の本人確認を模擬する（署名は作らない）。
      async get() { await delay(); return ok({ id: nextId('mock-assertion'), demo: true }); },
    },
  };
}
