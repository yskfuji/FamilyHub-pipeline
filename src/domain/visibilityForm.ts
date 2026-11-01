import { allowedAudiencesFor } from '../authz/policy';
import type { Id, MembershipRole, VisibilityAudience, VisibilityPolicy } from './types';

/** 公開範囲を持つ記録の種類。メモには「参加者」がない。 */
export type SharedKind = 'event' | 'task' | 'memo';

export const MAX_SELECTED_MEMBERS = 8;

const chooseable = (role: MembershipRole, kind: SharedKind) => allowedAudiencesFor(role).filter((audience) => kind !== 'memo' || audience !== 'participants');

/** 選べる公開範囲。選べない範囲の記録でも、今の範囲は表示する（変えなければ送らない）。 */
export function audienceChoices(role: MembershipRole, kind: SharedKind, current?: VisibilityAudience): readonly VisibilityAudience[] {
  const allowed = chooseable(role, kind);
  return current && !allowed.includes(current) ? [current, ...allowed] : allowed;
}

/** 新しい記録の公開範囲。本人の初期値を選べないときは、選べる最初の範囲にする。 */
export function defaultAudience(role: MembershipRole, kind: SharedKind, preferred: VisibilityAudience | undefined): VisibilityAudience {
  const allowed = chooseable(role, kind);
  return allowed.find((audience) => audience === preferred) ?? allowed[0];
}

export function visibilityProblem(audience: VisibilityAudience, selectedIds: readonly Id[]): string | null {
  if (audience === 'selected' && !selectedIds.length) return '公開する人を1人以上選んでください。';
  if (selectedIds.length > MAX_SELECTED_MEMBERS) return `選べるのは${MAX_SELECTED_MEMBERS}人までです。`;
  return null;
}

export const visibilityInput = <A extends VisibilityAudience>(audience: A, selectedIds: Id[]) => ({ audience, selectedMembershipIds: audience === 'selected' ? selectedIds : [] });

/** 変えたときだけ公開範囲を送る（子どもが選べない範囲の記録を、ほかの項目だけ直せるようにするため）。 */
export function visibilityChange<A extends VisibilityAudience>(audience: A, selectedIds: Id[], original: VisibilityPolicy) {
  const next = visibilityInput(audience, selectedIds);
  const before = original.selectedMembershipIds;
  const same = audience === original.audience && next.selectedMembershipIds.length === before.length && next.selectedMembershipIds.every((id) => before.includes(id));
  return same ? {} : { visibility: next };
}
