import { allowedAudiencesFor, authorize, capabilitiesFor, projectSnapshotForViewer, redactPlace } from '../../authz/policy';
import { ja } from '../../content/ja';
import type { Album, AlbumItem, AuthorizationDecision, OccurrenceDeletion, CalendarEvent, Capability, Expense, GatewayError, HouseholdInvite, HouseholdMembership, HouseholdNotification, HouseholdSnapshot, Id, Memo, MutationContext, NotificationPreferences, PermissionOverride, PlaceRef, PrivacySettings, Result, Rfc3339, Todo, User, ViewerContext, VisibilityAudience, VisibilityPolicy } from '../types';
import { RESTORE_WINDOW_DAYS } from '../restoreWindow';

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
  /** アルバムは件数が多くなるので、必要な操作のときだけ読み込む。スナップショットには含めない。 */
  albums: Album[];
  albumItems: AlbumItem[];
  /** 1回分だけ削除した予定の記録。最近削除から元に戻すために持つ。 */
  occurrenceDeletions: OccurrenceDeletion[];
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

const RESTORE_WINDOW_MS = RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T,>(error: GatewayError): Result<T> => ({ ok: false, error });
export const denied = <T,>(decision: AuthorizationDecision, message = ja.errors.FORBIDDEN): Result<T> => fail({ code: 'FORBIDDEN', message, retryable: false, reason: decision.allowed ? 'CAPABILITY_MISSING' : decision.reason });
export const missing = <T,>(label: string): Result<T> => fail({ code: 'NOT_FOUND', message: `${label}が見つからないか、表示する権限がありません。`, retryable: false });
export const invalid = <T,>(issues: ReadonlyArray<{ message: string }>): Result<T> => fail({ code: 'INVALID_INPUT', message: issues[0]?.message ?? '入力を確認してください。', retryable: false });
export const conflict = <T,>(label: string): Result<T> => fail({ code: 'CONFLICT', message: `別の端末で${label}が更新されています。現在の内容を確認してください。`, retryable: true, reason: 'VERSION' });
/** 変更を当てる。null は項目を外す。undefined は変えない。 */
export function applyPatch<T extends object>(target: T, changes: object) {
  const record = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (value === null) delete record[key]; else record[key] = value;
  }
}
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
  /** 入力された公開範囲を、作った人を保ったまま確かめる。 */
  const resolveVisibility = (input: { audience: VisibilityAudience; selectedMembershipIds?: Id[] }, creatorMembershipId: Id): Result<VisibilityPolicy> => {
    if (!allowedAudiencesFor(viewer().role).includes(input.audience)) return denied({ allowed: false, reason: 'SCOPE_DENIED' }, 'この公開範囲は選べません。');
    const selectedMembershipIds = input.selectedMembershipIds ?? [];
    const outsider = foreignMember<VisibilityPolicy>(selectedMembershipIds); if (outsider) return outsider;
    if (input.audience === 'selected' && selectedMembershipIds.length === 0) return invalid([{ message: '公開する人を1人以上選んでください。' }]);
    return ok({ audience: input.audience, creatorMembershipId, selectedMembershipIds: input.audience === 'selected' ? selectedMembershipIds : [] });
  };
  /** 色のリストは同じ家族のものだけを指せる。 */
  const foreignLabel = <T,>(id: Id | null | undefined): Result<T> | null => id && !state.colorLabels.some((item) => item.id === id) ? invalid<T>([{ message: 'リストを確認してください。' }]) : null;
  const project = (): HouseholdSnapshot => {
    const current = viewer();
    const snapshot = projectSnapshotForViewer({ ...state, permissionOverrides: a.permissionOverrides }, current);
    const base = { ...snapshot.user, id: current.userId, displayName: actor().displayName };
    snapshot.user = env.describeUser?.(actor(), base) ?? base;
    return snapshot;
  };
  return { a, state, env, now, nextId, actor, viewer, requireCapability, offlineFailure, permissionConflict, visible, placeWriteGuard, withinRestoreWindow, defaultVisibility, foreignMember, foreignLabel, resolveVisibility, project };
}
