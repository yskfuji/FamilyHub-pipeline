import { describe, expect, it } from 'vitest';
import type { HouseholdMembership } from './types';
import { activeMemberCount, nameChangesLeft, recentNameChanges } from './householdLimits';

const now = '2026-10-02T12:00:00+09:00';

describe('家族グループの上限', () => {
  it('名前の変更は24時間で3回まで数える', () => {
    expect(nameChangesLeft(undefined, now)).toBe(3);
    expect(nameChangesLeft(['2026-10-02T11:00:00+09:00'], now)).toBe(2);
    expect(nameChangesLeft(['2026-10-02T11:00:00+09:00', '2026-10-02T10:00:00+09:00', '2026-10-02T09:00:00+09:00', '2026-10-02T08:00:00+09:00'], now)).toBe(0);
  });
  it('24時間を過ぎた変更は数えない', () => {
    expect(recentNameChanges(['2026-10-01T12:00:00+09:00', '2026-10-01T12:00:01+09:00'], now)).toEqual(['2026-10-01T12:00:01+09:00']);
  });
  it('人数は利用中のメンバーだけを数える', () => {
    const member = (status: HouseholdMembership['status']) => ({ status }) as HouseholdMembership;
    expect(activeMemberCount([member('active'), member('suspended'), member('left'), member('active')])).toBe(2);
  });
});
