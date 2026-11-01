import { describe, expect, it } from 'vitest';
import type { HouseholdMembership } from './types';
import { eventInvolves, expenseInvolves, inScope, memberScopeChoices, memoInvolves, parseMemberScope, scopedMemberId, shownMemberScope, todoInvolves } from './memberScope';

const member = (id: string, status: HouseholdMembership['status'] = 'active'): HouseholdMembership => ({ id, householdId: 'h', userId: `u-${id}`, displayName: id.toUpperCase(), role: 'adult', status, color: '#000000', version: 1 });
const people = [member('a'), member('b'), member('c', 'suspended'), member('d', 'left')];
const visibility = (creatorMembershipId: string) => ({ audience: 'household' as const, creatorMembershipId, selectedMembershipIds: [] });

describe('メンバーで絞る', () => {
  it('読めない値はすべてとして扱う', () => {
    expect(parseMemberScope(null)).toBe('all');
    expect(parseMemberScope('')).toBe('all');
    expect(parseMemberScope('me')).toBe('me');
  });

  it('絞る相手を本人の ID か利用中のメンバーへ解決する', () => {
    expect(scopedMemberId('all', 'a', people)).toBeNull();
    expect(scopedMemberId('me', 'a', people)).toBe('a');
    expect(scopedMemberId('b', 'a', people)).toBe('b');
  });

  it('停止中、退出済み、知らないメンバーならすべての表示へ戻す', () => {
    expect(scopedMemberId('c', 'a', people)).toBeNull();
    expect(scopedMemberId('d', 'a', people)).toBeNull();
    expect(scopedMemberId('zzz', 'a', people)).toBeNull();
    expect(shownMemberScope('zzz', 'a', people)).toBe('all');
    expect(shownMemberScope('me', 'a', people)).toBe('me');
    expect(shownMemberScope('b', 'a', people)).toBe('b');
  });

  it('選択肢は、すべて、自分、本人以外の利用中のメンバー', () => {
    expect(memberScopeChoices('a', people).map((choice) => choice.value)).toEqual(['all', 'me', 'b']);
  });

  it('予定は、作った人、担当する人、参加者が当事者', () => {
    const event = { ownerMembershipId: 'b', participantMembershipIds: ['c'], visibility: visibility('a') };
    expect(eventInvolves(event, 'a')).toBe(true);
    expect(eventInvolves(event, 'b')).toBe(true);
    expect(eventInvolves(event, 'c')).toBe(true);
    expect(eventInvolves(event, 'd')).toBe(false);
  });

  it('タスクは、作った人、担当する人、確認する人が当事者', () => {
    const todo = { creatorMembershipId: 'a', assigneeMembershipId: 'b', reviewerMembershipId: 'c' };
    expect(todoInvolves(todo, 'a')).toBe(true);
    expect(todoInvolves(todo, 'b')).toBe(true);
    expect(todoInvolves(todo, 'c')).toBe(true);
    expect(todoInvolves({ ...todo, reviewerMembershipId: undefined }, 'c')).toBe(false);
  });

  it('メモは書いた人だけが当事者', () => {
    expect(memoInvolves({ authorMembershipId: 'a' }, 'a')).toBe(true);
    expect(memoInvolves({ authorMembershipId: 'a' }, 'b')).toBe(false);
  });

  it('支出は、記録した人、支払った人、負担する人が当事者', () => {
    const expense = { creatorMembershipId: 'a', payerMembershipId: 'b', shares: [{ membershipId: 'c', amountJpy: 100, settledJpy: 0 }] };
    expect(expenseInvolves(expense, 'a')).toBe(true);
    expect(expenseInvolves(expense, 'b')).toBe(true);
    expect(expenseInvolves(expense, 'c')).toBe(true);
    expect(expenseInvolves(expense, 'd')).toBe(false);
  });

  it('inScope は null なら全件、ID なら関わる記録だけを返す', () => {
    const memos = [{ authorMembershipId: 'a' }, { authorMembershipId: 'b' }];
    expect(inScope(memos, null, memoInvolves)).toHaveLength(2);
    expect(inScope(memos, 'b', memoInvolves)).toEqual([{ authorMembershipId: 'b' }]);
  });
});
