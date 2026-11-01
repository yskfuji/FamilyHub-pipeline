import { useMemo } from 'react';
import { eventInvolves, expenseInvolves, inScope, memoInvolves, scopedMemberId, todoInvolves } from '../domain/memberScope';
import { useApp } from './AppContext';
import { useDevicePreferences } from './devicePreferences';

/** 表示する人で絞った記録。詳細を URL で開くときは、絞り込みの外でも snapshot から探す。 */
export function useMemberScope() {
  const { snapshot } = useApp();
  const { memberScope } = useDevicePreferences();
  const memberId = scopedMemberId(memberScope, snapshot.viewer.membershipId, snapshot.memberships);
  const { events, todos, memos, expenses } = snapshot;
  return useMemo(() => ({
    memberId,
    events: inScope(events, memberId, eventInvolves),
    todos: inScope(todos, memberId, todoInvolves),
    memos: inScope(memos, memberId, memoInvolves),
    expenses: inScope(expenses, memberId, expenseInvolves),
  }), [memberId, events, todos, memos, expenses]);
}
