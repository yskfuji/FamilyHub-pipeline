import { authorize, capabilitiesFor, projectSnapshotForViewer, redactPlace } from '../../authz/policy';
import { ja } from '../../content/ja';
import type { AuthorizationDecision, CalendarEvent, Capability, Expense, GatewayError, HouseholdInvite, HouseholdMembership, HouseholdNotification, HouseholdSnapshot, Id, Memo, MutationContext, NotificationPreferences, PermissionOverride, PlaceRef, PrivacySettings, Result, Rfc3339, Todo, User, ViewerContext } from '../types';

/** 非同期のポートを、同じ引数で同期に結果を返す形へ置き換える。規則は同期で書き、遅延や保存は呼び出し側が担う。 */
export type SyncPort<P> = { [K in keyof P]: P[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => R : never };

export interface HouseholdArchives {
  events: Record<Id, CalendarEvent>;
  todos: Record<Id, Todo>;
  memos: Record<Id, Memo>;
  expenses: Record<Id, Expense>;
}

/** 1つの家族の記録すべて。規則はこの1つのまとまりを変更し、保存は呼び出し側が行う。 */
export interface HouseholdAggregate {
  state: HouseholdSnapshot;
  permissionOverrides: PermissionOverride[];
  permissionRevision: number;
  invites: HouseholdInvite[];
  notifications: HouseholdNotification[];
  notificationPreferences: NotificationPreferences;
  privacy: PrivacySettings;
  archives: HouseholdArchives;
}

export interface CommandEnv {
  actorMembershipId: Id;
  now(): Rfc3339;
  nextId(prefix: string): Id;
  newInviteToken(): string;
  /** 確認用の表示状態でだけ使う。接続できない状態を再現する。 */
  connectionLost?(): boolean;
  describeUser?(member: HouseholdMembership, base: User): User;
}

const RESTORE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T,>(error: GatewayError): Result<T> => ({ ok: false, error });
export const denied = <T,>(decision: AuthorizationDecision, message = ja.errors.FORBIDDEN): Result<T> => fail({ code: 'FORBIDDEN', message, retryable: false, reason: decision.allowed ? 'CAPABILITY_MISSING' : decision.reason });
export const missing = <T,>(label: string): Result<T> => fail({ code: 'NOT_FOUND', message: `${label}が見つからないか、表示する権限がありません。`, retryable: false });
export const invalid = <T,>(issues: ReadonlyArray<{ message: string }>): Result<T> => fail({ code: 'INVALID_INPUT', message: issues[0]?.message ?? '入力を確認してください。', retryable: false });
export const conflict = <T,>(label: string): Result<T> => fail({ code: 'CONFLICT', message: `別の端末で${label}が更新されています。現在の内容を確認してください。`, retryable: true, reason: 'VERSION' });
export const archive = <T,>(record: Record<Id, T>, id: Id, value: T) => { record[id] = value; };

export type CommandContext = ReturnType<typeof createCommandContext>;

export function createCommandContext(a: HouseholdAggregate, env: CommandEnv) {
  const { state } = a;
  const { now, nextId } = env;
  const actor = () => {
    const member = state.memberships.find((item) => item.id === env.actorMembershipId);
    if (!member) throw new Error('操作する人が家族に含まれていません');
    return member;
  };
  const viewer = (): ViewerContext => {
    const member = actor();
    const overrides = a.permissionOverrides.filter((item) => item.membershipId === member.id);
    return { userId: member.userId, membershipId: member.id, role: member.role, status: member.status, capabilities: capabilitiesFor(member.role, overrides), permissionRevision: a.permissionRevision };
  };
  const requireCapability = <T,>(capability: Capability): Result<T> | null => {
    const decision = authorize(viewer(), capability);
    return decision.allowed ? null : denied<T>(decision);
  };
  const offlineFailure = <T,>(): Result<T> | null => env.connectionLost?.() ? fail({ code: 'OFFLINE', message: 'インターネットに接続できません。接続後にもう一度お試しください。', retryable: true }) : null;
  const permissionConflict = <T,>(context?: MutationContext): Result<T> | null => context && context.expectedPermissionRevision !== a.permissionRevision
    ? fail({ code: 'CONFLICT', message: '権限が変更されています。現在の権限で内容を確認してください。', retryable: false, reason: 'PERMISSION_REVISION' })
    : null;
  const visible = <T extends { place?: PlaceRef }>(item: T): T => redactPlace(structuredClone(item), viewer());
  const placeWriteGuard = <T,>(place: unknown): Result<T> | null => {
    if (place === undefined) return null;
    const decision = authorize(viewer(), 'place.read');
    return decision.allowed ? null : denied<T>(decision);
  };
  const withinRestoreWindow = (deletedAt?: string) => !deletedAt || Date.parse(now()) - Date.parse(deletedAt) <= RESTORE_WINDOW_MS;
  const defaultVisibility = () => ({ audience: a.privacy.defaultAudience, creatorMembershipId: viewer().membershipId, selectedMembershipIds: [] as Id[] });
  /** 入力に含まれる人が、この家族のメンバーであることを確かめる。他の家族の ID は受け付けない。 */
  const foreignMember = <T,>(ids: ReadonlyArray<Id | undefined>): Result<T> | null => {
    const known = new Set(state.memberships.map((item) => item.id));
    return ids.some((id) => id !== undefined && !known.has(id)) ? invalid<T>([{ message: '選んだ人を確認してください。' }]) : null;
  };
  const project = (): HouseholdSnapshot => {
    const current = viewer();
    const snapshot = projectSnapshotForViewer(state, current);
    snapshot.permissionOverrides = current.role === 'owner' ? structuredClone(a.permissionOverrides) : [];
    const base = { ...snapshot.user, id: current.userId, displayName: actor().displayName };
    snapshot.user = env.describeUser?.(actor(), base) ?? base;
    return snapshot;
  };
  return { a, state, env, now, nextId, actor, viewer, requireCapability, offlineFailure, permissionConflict, visible, placeWriteGuard, withinRestoreWindow, defaultVisibility, foreignMember, project };
}
