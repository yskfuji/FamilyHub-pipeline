import { z } from 'zod';
import { accountUpdateSchema } from './account';
import { albumUpdateSchema, eventUpdateSchema, expenseUpdateSchema, idSchema, isoDateSchema, memoInputSchema, todoUpdateSchema } from './schemas';
import type { Id, IsoDate, Rfc3339 } from './types';

/**
 * 変更の記録（監査の記録）の見せ方。API と確認用の実装が同じ規則を使う。
 * 記録には本文・秘密・トークン・IP を残さない。detail は変えた項目の名前だけ（{"fields":["kind"]}）。
 */
/** 変更の記録を残す月数の既定（FAMILY_HUB_AUDIT_RETENTION_MONTHS で変えられる）。規約とポリシーにも書く。 */
export const AUDIT_RETENTION_MONTHS = 24;

export const auditGroups = ['account', 'household', 'members', 'events', 'tasks', 'memos', 'expenses', 'albums', 'links', 'notifications', 'assistant', 'operator'] as const;
export type AuditGroup = typeof auditGroups[number] | 'other';

/** 種類のまとまりごとの操作。操作の名前は OpenAPI の operationId（運営者の命令は operator.*）。 */
export const auditGroupActions: Record<typeof auditGroups[number], readonly string[]> = {
  account: ['signUp', 'signInWithPassword', 'verifyTotp', 'finishPasskey', 'signIn', 'confirmPasswordReset', 'updateAccount', 'changeEmail', 'deleteAccount', 'confirmTotpEnrollment', 'enableTotp', 'disableTotp', 'changePassword', 'finishPasskeyRegistration', 'revokeSession'],
  household: ['createHousehold', 'updateHouseholdProfile', 'savePrivacySettings', 'createColorLabel', 'updateColorLabel', 'deleteColorLabel'],
  members: ['acceptInvite', 'createHouseholdInvite', 'revokeHouseholdInvite', 'updateMembershipRole', 'updatePermissionOverrides', 'resetPermissionOverrides', 'transferOwnership', 'leaveHousehold', 'setMemberStatus', 'removeMember'],
  events: ['createEvent', 'updateRecurringEvent', 'deleteEvent', 'restoreEvent'],
  tasks: ['createTodo', 'updateTodoStatus', 'updateTodo', 'deleteTodo', 'restoreTodo'],
  memos: ['createMemo', 'updateMemo', 'deleteMemo', 'restoreMemo', 'uploadAttachment', 'deleteAttachment'],
  expenses: ['createExpense', 'updateExpense', 'deleteExpense', 'restoreExpense', 'recordSettlement', 'reverseSettlement', 'settleAll', 'reverseBatch'],
  albums: ['createAlbum', 'updateAlbum', 'deleteAlbum', 'restoreAlbum', 'reorderAlbumItems', 'deleteAlbumItem', 'restoreAlbumItem', 'createUpload'],
  links: ['createItemLink', 'deleteItemLink'],
  notifications: ['markNotificationRead', 'snoozeNotification', 'stopNotification', 'resumeNotification', 'updateNotificationPreferences'],
  assistant: ['readReceipt', 'readEventImage', 'readEventUrl'],
  operator: ['operator.grant', 'operator.expire', 'operator.suspended', 'operator.active', 'operator.keysRotate', 'operator.keysRetire', 'operator.totpReset', 'operator.auditPrune'],
};

const groupByAction = new Map(Object.entries(auditGroupActions).flatMap(([group, actions]) => actions.map((action) => [action, group as AuditGroup] as const)));
export const auditGroupOf = (action: string): AuditGroup => groupByAction.get(action) ?? 'other';

/** 記録が指す対象の種類。操作の名前から決まる。 */
export type AuditTargetKind = 'event' | 'task' | 'memo' | 'expense' | 'settlementBatch' | 'album' | 'member' | 'invite' | 'colorLabel' | 'link' | 'notification';
const targetKinds: Record<string, AuditTargetKind> = Object.fromEntries([
  ...(['createEvent', 'updateRecurringEvent', 'deleteEvent', 'restoreEvent'] as const).map((action) => [action, 'event']),
  ...(['createTodo', 'updateTodoStatus', 'updateTodo', 'deleteTodo', 'restoreTodo'] as const).map((action) => [action, 'task']),
  ...(['createMemo', 'updateMemo', 'deleteMemo', 'restoreMemo', 'uploadAttachment', 'deleteAttachment'] as const).map((action) => [action, 'memo']),
  ...(['createExpense', 'updateExpense', 'deleteExpense', 'restoreExpense', 'recordSettlement', 'reverseSettlement'] as const).map((action) => [action, 'expense']),
  ...(['settleAll', 'reverseBatch'] as const).map((action) => [action, 'settlementBatch']),
  ...(['createAlbum', 'updateAlbum', 'deleteAlbum', 'restoreAlbum', 'reorderAlbumItems', 'deleteAlbumItem', 'restoreAlbumItem'] as const).map((action) => [action, 'album']),
  ...(['updateMembershipRole', 'updatePermissionOverrides', 'resetPermissionOverrides', 'setMemberStatus', 'removeMember', 'operator.suspended', 'operator.active'] as const).map((action) => [action, 'member']),
  ...(['acceptInvite', 'createHouseholdInvite', 'revokeHouseholdInvite'] as const).map((action) => [action, 'invite']),
  ...(['createColorLabel', 'updateColorLabel', 'deleteColorLabel'] as const).map((action) => [action, 'colorLabel']),
  ...(['createItemLink', 'deleteItemLink'] as const).map((action) => [action, 'link']),
  ...(['markNotificationRead', 'snoozeNotification', 'stopNotification', 'resumeNotification'] as const).map((action) => [action, 'notification']),
]);
export const auditTargetKindOf = (action: string): AuditTargetKind | null => targetKinds[action] ?? null;

/** 誰が行ったか。家族のメンバー、運営者、またはもう家族にいない人。 */
export type AuditActor = { kind: 'member'; membershipId: Id; displayName: string } | { kind: 'operator' } | { kind: 'former' };
/** 対象。閲覧者が見られない記録（なくなった記録を含む）は ID を伏せ、hidden を true にする（画面では「見られない記録」）。 */
export interface AuditTarget { kind: AuditTargetKind; id: Id | null; hidden: boolean }
export interface AuditDetail { fields: string[] }
export interface AuditEntry { id: Id; at: Rfc3339; actor: AuditActor; action: string; group: AuditGroup; target: AuditTarget | null; detail: AuditDetail | null }
/** 鎖の確認の結果。unchecked はまだ確かめていない。 */
export interface AuditChainStatus { state: 'ok' | 'problem' | 'unchecked'; checkedAt: Rfc3339 | null }
export interface AuditPage { items: AuditEntry[]; nextCursor: string | null; chain: AuditChainStatus }
export interface AccountAuditEntry { id: Id; at: Rfc3339; actor: { kind: 'self' } | { kind: 'operator' }; action: string; group: AuditGroup; detail: AuditDetail | null }
export interface AccountAuditPage { items: AccountAuditEntry[]; nextCursor: string | null }

export interface AuditQuery { cursor?: string; limit?: number; membershipId?: Id; group?: typeof auditGroups[number]; action?: string; from?: IsoDate; to?: IsoDate }
export interface AccountAuditQuery { cursor?: string; limit?: number }

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 100;
const cursorSchema = z.string().regex(/^\d{1,15}$/);
const limitSchema = z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT);
export const auditQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(), limit: limitSchema,
  membershipId: idSchema.optional(), group: z.enum(auditGroups).optional(), action: z.string().regex(/^[A-Za-z.]{1,60}$/).optional(),
  from: isoDateSchema.optional(), to: isoDateSchema.optional(),
});
export const accountAuditQuerySchema = z.strictObject({ cursor: cursorSchema.optional(), limit: limitSchema });

/** 記録された1行（audit.db の audit_events から鎖の hash を除いたもの）。 */
export interface StoredAuditRow { seq: number; id: Id; at: Rfc3339; household_id: Id | null; actor_user_id: Id | null; action: string; target: string | null; detail: string | null }
/** 行の絞り込み。SQL（server/audit/store.ts）と確認用の実装（matchesAuditFilter）が同じ意味で使う。 */
export interface AuditRowFilter { actorUserId?: Id; actions?: readonly string[]; from?: IsoDate; to?: IsoDate }

/** 種類と操作の名前を、絞り込む操作の一覧にする。空の一覧なら1件も当たらない。どちらもなければ絞り込まない。 */
export function actionsFor(query: Pick<AuditQuery, 'group' | 'action'>): readonly string[] | undefined {
  const group = query.group === undefined ? undefined : auditGroupActions[query.group];
  if (query.action !== undefined) return !group || group.includes(query.action) ? [query.action] : [];
  return group;
}

/** 日付は記録の時刻の日付（家族の時間帯で書いた RFC 3339 の先頭10文字）で比べる。 */
export function matchesAuditFilter(row: StoredAuditRow, filter: AuditRowFilter) {
  const day = row.at.slice(0, 10);
  return (filter.actorUserId === undefined || row.actor_user_id === filter.actorUserId)
    && (filter.actions === undefined || filter.actions.includes(row.action))
    && (filter.from === undefined || day >= filter.from)
    && (filter.to === undefined || day <= filter.to);
}

/** detail から変えた項目の名前だけを取り出す。ほかの形（運営者の命令の補足など）は返さない。 */
export function auditDetailOf(detail: string | null): AuditDetail | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as unknown;
    const fields = (parsed as { fields?: unknown } | null)?.fields;
    return Array.isArray(fields) && fields.every((item) => typeof item === 'string') ? { fields: [...fields] as string[] } : null;
  } catch {
    return null;
  }
}

const fieldSchemas: Record<string, { shape: Record<string, unknown> }> = {
  updateExpense: expenseUpdateSchema, updateRecurringEvent: eventUpdateSchema, updateTodo: todoUpdateSchema, updateMemo: memoInputSchema, updateAlbum: albumUpdateSchema,
  updateAccount: accountUpdateSchema,
};

/** 変更の入力のうち、記録に残す項目の名前（値は残さない）。入力の形が決まっていない操作では null。 */
export function auditFieldsFor(operationId: string, input: unknown): string[] | null {
  const schema = fieldSchemas[operationId];
  if (!schema || !input || typeof input !== 'object') return null;
  return Object.entries(input as Record<string, unknown>).filter(([key, value]) => value !== undefined && Object.hasOwn(schema.shape, key)).map(([key]) => key).sort();
}

/** 次のページの印。番号は利用者に意味を持たせない（そのまま返す）。 */
export const nextCursorOf = (rows: readonly StoredAuditRow[], limit: number) => rows.length > limit ? String(rows[limit - 1].seq) : null;
