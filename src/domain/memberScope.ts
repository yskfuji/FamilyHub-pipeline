import type { CalendarEvent, Expense, HouseholdMembership, Id, Memo, Todo } from './types';

/** 表示を絞る相手。all はすべて、me は見ている本人、それ以外はメンバーの ID。 */
export type MemberScope = 'all' | 'me' | Id;

export interface MemberScopeChoice { value: MemberScope; label: string }

/** 保存された値を読む。読めないときはすべてを表示する。 */
export const parseMemberScope = (value: string | null | undefined): MemberScope => value || 'all';

/**
 * 絞る相手のメンバー ID。すべてなら null。
 * 保存したメンバーが停止中や退出済みなら、空の画面にしないよう、すべての表示へ戻す。
 */
export function scopedMemberId(scope: MemberScope, viewerId: Id, memberships: readonly HouseholdMembership[]): Id | null {
  if (scope === 'all') return null;
  if (scope === 'me') return viewerId;
  return memberships.some((member) => member.id === scope && member.status === 'active') ? scope : null;
}

/** 選択肢。本人を除いた、利用中のメンバーを並べる。 */
export function memberScopeChoices(viewerId: Id, memberships: readonly HouseholdMembership[]): MemberScopeChoice[] {
  return [
    { value: 'all', label: 'すべて' },
    { value: 'me', label: '自分' },
    ...memberships.filter((member) => member.status === 'active' && member.id !== viewerId).map((member) => ({ value: member.id, label: member.displayName })),
  ];
}

/** 選択肢に合わせた値。保存したメンバーが選べないときは all。 */
export const shownMemberScope = (scope: MemberScope, viewerId: Id, memberships: readonly HouseholdMembership[]): MemberScope => (scope === 'me' || scopedMemberId(scope, viewerId, memberships) !== null ? scope : 'all');

/** 予定：作った人、主に担当する人、参加者。 */
export const eventInvolves = (event: Pick<CalendarEvent, 'ownerMembershipId' | 'participantMembershipIds' | 'visibility'>, id: Id) =>
  event.ownerMembershipId === id || event.visibility.creatorMembershipId === id || event.participantMembershipIds.includes(id);

/** タスク：作った人、担当する人、確認する人。 */
export const todoInvolves = (todo: Pick<Todo, 'creatorMembershipId' | 'assigneeMembershipId' | 'reviewerMembershipId'>, id: Id) =>
  todo.creatorMembershipId === id || todo.assigneeMembershipId === id || todo.reviewerMembershipId === id;

/** メモ：書いた人。 */
export const memoInvolves = (memo: Pick<Memo, 'authorMembershipId'>, id: Id) => memo.authorMembershipId === id;

/** 支出と収入：記録した人、支払った人、負担する人。 */
export const expenseInvolves = (expense: Pick<Expense, 'creatorMembershipId' | 'payerMembershipId' | 'shares'>, id: Id) =>
  expense.creatorMembershipId === id || expense.payerMembershipId === id || expense.shares.some((share) => share.membershipId === id);

/** 関わる記録だけを残す。id が null ならそのまま返す。 */
export const inScope = <T>(items: T[], id: Id | null, involves: (item: T, id: Id) => boolean): T[] => (id === null ? items : items.filter((item) => involves(item, id)));
