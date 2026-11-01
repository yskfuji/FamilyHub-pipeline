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
