import type { HouseholdMembership, Rfc3339 } from './types';

/** 1つの家族グループで利用できる人数。 */
export const MAX_HOUSEHOLD_MEMBERS = 8;
/** 名前を変えられる回数（24時間あたり）。 */
export const MAX_NAME_CHANGES_PER_DAY = 3;
const DAY_MS = 86_400_000;

/** 直近24時間の変更の記録。 */
export const recentNameChanges = (changes: readonly Rfc3339[] | undefined, now: Rfc3339): Rfc3339[] => (changes ?? []).filter((at) => Date.parse(now) - Date.parse(at) < DAY_MS);

export const nameChangesLeft = (changes: readonly Rfc3339[] | undefined, now: Rfc3339) => Math.max(0, MAX_NAME_CHANGES_PER_DAY - recentNameChanges(changes, now).length);

export const activeMemberCount = (memberships: readonly HouseholdMembership[]) => memberships.filter((member) => member.status === 'active').length;

/** 利用中の管理者。最後の1人は退出できない（A12-1）。規則と画面が同じものを使う。 */
export const activeOwners = <T extends Pick<HouseholdMembership, 'role' | 'status'>>(memberships: readonly T[]) => memberships.filter((member) => member.role === 'owner' && member.status === 'active');

/**
 * 退出の画面に出すもの。管理者でなければ member、ほかにも利用中の管理者がいれば co-owner（退出できる）、
 * 自分だけが管理者なら sole-owner（先に管理者を引き継いでもらう）。
 */
export function leaveStateFor(memberships: readonly HouseholdMembership[], viewerMembershipId: string): 'member' | 'co-owner' | 'sole-owner' {
  const self = memberships.find((member) => member.id === viewerMembershipId);
  if (self?.role !== 'owner') return 'member';
  return activeOwners(memberships).some((member) => member.id !== viewerMembershipId) ? 'co-owner' : 'sole-owner';
}
