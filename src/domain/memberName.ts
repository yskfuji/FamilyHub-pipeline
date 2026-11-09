import type { HouseholdSnapshot } from './types';

/** メンバーの表示名。見えない人や退出した人は「非公開」。 */
export function memberName(snapshot: Pick<HouseholdSnapshot, 'memberships'>, id?: string) {
  return snapshot.memberships.find((member) => member.id === id)?.displayName ?? '非公開';
}
