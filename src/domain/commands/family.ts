import type { FamilyPort } from '../../data/gateway';
import { colorLabelInputSchema } from '../schemas';
import type { ColorLabel, HouseholdMembership, Id, Result } from '../types';
import { conflict, denied, fail, invalid, missing, ok } from './context';
import type { CommandContext, SyncPort } from './context';

type Membership = HouseholdMembership;

export function createFamilyCommands(c: CommandContext): SyncPort<FamilyPort> {
  const { a, state, nextId, viewer, requireCapability, ownerCandidateProblem } = c;
  const member = (id: Id) => state.memberships.find((item) => item.id === id && item.status !== 'left');
  const changed = () => { a.permissionRevision += 1; };
  const owners = () => state.memberships.filter((item) => item.role === 'owner' && item.status === 'active');
  const removalGuard = <T,>(target: Membership): Result<T> | null => {
    if (target.id === viewer().membershipId) return denied({ allowed: false, reason: 'SCOPE_DENIED' }, '自分自身には行えません。');
    if (target.role === 'owner') return denied({ allowed: false, reason: 'OWNER_REQUIRED' }, '管理者には行えません。先に管理者を移してください。');
    return null;
  };
  return {
    transferOwnership(toMembershipId, expectedVersion) {
      const guard = requireCapability<Membership>('household.members.manage'); if (guard) return guard;
      const target = member(toMembershipId);
      const self = state.memberships.find((item) => item.id === viewer().membershipId);
      if (!target || !self) return missing('メンバー');
      const problem = ownerCandidateProblem<Membership>(target); if (problem) return problem;
      if (target.version !== expectedVersion) return conflict('メンバー');
      target.role = 'owner'; target.version += 1;
      self.role = 'adult'; self.version += 1;
      changed();
      return ok(structuredClone(target));
    },
    setMemberStatus(membershipId, status, expectedVersion) {
      const guard = requireCapability<Membership>('household.members.manage'); if (guard) return guard;
      const target = member(membershipId);
      if (!target) return missing('メンバー');
      const blocked = removalGuard<Membership>(target); if (blocked) return blocked;
      if (target.version !== expectedVersion) return conflict('メンバー');
      target.status = status; target.version += 1;
      changed();
      return ok(structuredClone(target));
    },
    removeMember(membershipId, expectedVersion) {
      const guard = requireCapability<void>('household.members.manage'); if (guard) return guard;
      const target = member(membershipId);
      if (!target) return missing('メンバー');
      const blocked = removalGuard<void>(target); if (blocked) return blocked;
      if (target.version !== expectedVersion) return conflict('メンバー');
      target.status = 'left'; target.version += 1;
      a.permissionOverrides = a.permissionOverrides.filter((item) => item.membershipId !== membershipId);
      changed();
      return ok(undefined);
    },
    leaveHousehold() {
      const self = state.memberships.find((item) => item.id === viewer().membershipId);
      if (!self) return missing('メンバー');
      if (self.role === 'owner' && (owners().length === 1)) return fail({ code: 'FORBIDDEN', message: '管理者は、役割を別の大人に渡してから退出してください。', retryable: false, reason: 'OWNER_REQUIRED' });
      self.status = 'left'; self.version += 1;
      changed();
      return ok(undefined);
    },
    createColorLabel(input) {
      const guard = requireCapability<ColorLabel>('event.create'); if (guard) return guard;
      const parsed = colorLabelInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const label: ColorLabel = { id: nextId('label'), householdId: state.household.id, ...parsed.data };
      state.colorLabels = [...state.colorLabels, label];
      return ok(structuredClone(label));
    },
    updateColorLabel(id, input) {
      const guard = requireCapability<ColorLabel>('event.update'); if (guard) return guard;
      const label = state.colorLabels.find((item) => item.id === id);
      if (!label) return missing('リスト');
      const parsed = colorLabelInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      Object.assign(label, parsed.data);
      return ok(structuredClone(label));
    },
    deleteColorLabel(id) {
      const guard = requireCapability<void>('event.update'); if (guard) return guard;
      if (!state.colorLabels.some((item) => item.id === id)) return missing('リスト');
      state.colorLabels = state.colorLabels.filter((item) => item.id !== id);
      // 使っていた予定とタスクからは色だけを外す。記録は消さない。
      for (const event of state.events) if (event.colorLabelId === id) delete event.colorLabelId;
      for (const todo of state.todos) if (todo.colorLabelId === id) delete todo.colorLabelId;
      return ok(undefined);
    },
  };
}
