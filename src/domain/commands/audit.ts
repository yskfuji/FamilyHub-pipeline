import { authorize, authorizeVisibleResource, canSeeExpense } from '../../authz/policy';
import { accountAuditQuerySchema, actionsFor, auditDetailOf, auditGroupOf, auditQuerySchema, auditTargetKindOf, nextCursorOf } from '../auditLog';
import type { AccountAuditPage, AccountAuditQuery, AuditActor, AuditChainStatus, AuditPage, AuditQuery, AuditRowFilter, AuditTarget, AuditTargetKind, StoredAuditRow } from '../auditLog';
import type { Id, Result } from '../types';
import { invalid, ok } from './context';
import type { CommandContext } from './context';

/** 絞り込みを読み解いた結果。保存先は、この条件で新しい順に limit + 1 件を返す。 */
export interface AuditRequest { filter: AuditRowFilter; cursor?: number; limit: number }

/**
 * 変更の記録の規則。権限 audit.read（既定では管理者だけ）で家族の記録を読む。
 * 対象が閲覧者に見えない記録（なくなった記録を含む）なら、ID を伏せて hidden にする。
 */
export function createAuditCommands(context: CommandContext) {
  const { a, state, viewer, requireCapability, project } = context;

  const canSee = (kind: AuditTargetKind, id: Id): boolean => {
    const current = viewer();
    switch (kind) {
      case 'event': { const item = state.events.find((entry) => entry.id === id); return Boolean(item && authorizeVisibleResource(current, 'event.read', item.visibility, [item.ownerMembershipId, ...item.participantMembershipIds]).allowed); }
      case 'task': { const item = state.todos.find((entry) => entry.id === id); return Boolean(item && authorizeVisibleResource(current, 'task.read', item.visibility, [item.creatorMembershipId, item.assigneeMembershipId, ...(item.reviewerMembershipId ? [item.reviewerMembershipId] : [])]).allowed); }
      case 'memo': { const item = state.memos.find((entry) => entry.id === id); return Boolean(item && authorizeVisibleResource(current, 'memo.read', item.visibility, [item.authorMembershipId]).allowed); }
      case 'expense': { const item = state.expenses.find((entry) => entry.id === id); return Boolean(item && canSeeExpense(current, item)); }
      case 'album': { const item = a.albums.find((entry) => entry.id === id); return Boolean(item && authorizeVisibleResource(current, 'album.read', item.visibility, [item.creatorMembershipId]).allowed); }
      case 'member': return state.memberships.some((entry) => entry.id === id) && (id === current.membershipId || authorize(current, 'household.members.read').allowed);
      case 'invite': return a.invites.some((entry) => entry.id === id) && authorize(current, 'household.invites.manage').allowed;
      case 'colorLabel': return state.colorLabels.some((entry) => entry.id === id);
      case 'link': return project().links.some((entry) => entry.id === id);
      case 'notification': return a.notifications.some((entry) => entry.id === id && ((entry as { recipientMembershipId?: Id }).recipientMembershipId ?? current.membershipId) === current.membershipId);
    }
  };

  const targetOf = (row: StoredAuditRow): AuditTarget | null => {
    const kind = auditTargetKindOf(row.action);
    const id = row.target?.split('/')[0];
    if (!kind || !id) return null;
    return canSee(kind, id) ? { kind, id, hidden: false } : { kind, id: null, hidden: true };
  };

  const actorOf = (userId: Id | null): AuditActor => {
    if (userId === 'operator') return { kind: 'operator' };
    const member = state.memberships.find((entry) => entry.userId === userId);
    return member ? { kind: 'member', membershipId: member.id, displayName: member.displayName } : { kind: 'former' };
  };

  return {
    /** 一覧の条件を確かめる。権限がなければ FORBIDDEN。人の指定は、この家族のメンバーだけを受け付ける。 */
    request(query: AuditQuery | Record<string, unknown>): Result<AuditRequest> {
      const guard = requireCapability<AuditRequest>('audit.read'); if (guard) return guard;
      const parsed = auditQuerySchema.safeParse(query);
      if (!parsed.success) return invalid(parsed.error.issues);
      const { cursor, limit, membershipId, group, action, from, to } = parsed.data;
      let actorUserId: Id | undefined;
      if (membershipId) {
        const member = state.memberships.find((entry) => entry.id === membershipId);
        if (!member) return invalid([{ message: '選んだ人を確認してください。' }]);
        actorUserId = member.userId;
      }
      return ok({ filter: { actorUserId, actions: actionsFor({ group, action }), from: from as AuditRequest['filter']['from'], to: to as AuditRequest['filter']['to'] }, cursor: cursor === undefined ? undefined : Number(cursor), limit });
    },
    /** 保存先が返した行（limit + 1 件まで）を、画面に出す形にする。 */
    present(rows: readonly StoredAuditRow[], limit: number, chain: AuditChainStatus): Result<AuditPage> {
      const guard = requireCapability<AuditPage>('audit.read'); if (guard) return guard;
      const items = rows.slice(0, limit).map((row) => ({ id: row.id, at: row.at, actor: actorOf(row.actor_user_id), action: row.action, group: auditGroupOf(row.action), target: targetOf(row), detail: auditDetailOf(row.detail) }));
      return ok({ items, nextCursor: nextCursorOf(rows, limit), chain });
    },
  };
}

/** 本人のアカウントの記録の条件。家族に属していなくても使う（規則の外）。 */
export function accountAuditRequest(query: AccountAuditQuery | Record<string, unknown>): Result<{ cursor?: number; limit: number }> {
  const parsed = accountAuditQuerySchema.safeParse(query);
  if (!parsed.success) return invalid(parsed.error.issues);
  return ok({ cursor: parsed.data.cursor === undefined ? undefined : Number(parsed.data.cursor), limit: parsed.data.limit });
}

export function presentAccountAudit(rows: readonly StoredAuditRow[], limit: number): AccountAuditPage {
  return {
    items: rows.slice(0, limit).map((row) => ({ id: row.id, at: row.at, actor: row.actor_user_id === 'operator' ? { kind: 'operator' as const } : { kind: 'self' as const }, action: row.action, group: auditGroupOf(row.action), detail: auditDetailOf(row.detail) })),
    nextCursor: nextCursorOf(rows, limit),
  };
}
