import type {
  AuthorizationDecision,
  Capability,
  HouseholdMembership,
  HouseholdSnapshot,
  PermissionOverride,
  ViewerContext,
  VisibilityPolicy,
} from '../domain/types';

export const allCapabilities: Capability[] = [
  'household.members.read', 'household.members.manage', 'household.invites.manage',
  'event.read', 'event.create', 'event.update', 'event.delete',
  'task.read', 'task.create', 'task.update', 'task.delete', 'task.transition',
  'memo.read', 'memo.create', 'memo.update', 'memo.delete', 'memo.attach',
  'expense.read', 'expense.create', 'expense.settle',
  'insight.read', 'resource.read', 'settings.own', 'notification.manage',
];

const roleCeilings: Record<HouseholdMembership['role'], readonly Capability[]> = {
  owner: allCapabilities,
  adult: allCapabilities.filter((item) => !item.startsWith('household.') || item === 'household.members.read'),
  child: [
    'event.read', 'event.create', 'event.update', 'event.delete',
    'task.read', 'task.create', 'task.update', 'task.delete', 'task.transition',
    'memo.read', 'memo.create', 'memo.update', 'memo.delete', 'memo.attach',
    'resource.read', 'settings.own', 'notification.manage',
  ],
  guest: ['event.read', 'task.read', 'memo.read', 'resource.read', 'settings.own', 'notification.manage'],
};

const baseRoleCapabilities: Record<HouseholdMembership['role'], readonly Capability[]> = {
  owner: roleCeilings.owner,
  adult: roleCeilings.adult,
  child: roleCeilings.child,
  guest: roleCeilings.guest,
};

export function capabilitiesFor(role: HouseholdMembership['role'], overrides: PermissionOverride[] = []): Capability[] {
  const ceiling = new Set(roleCeilings[role]);
  const result = new Set(baseRoleCapabilities[role]);
  for (const override of overrides) {
    if (!ceiling.has(override.capability)) continue;
    if (override.effect === 'deny') result.delete(override.capability);
    else result.add(override.capability);
  }
  return allCapabilities.filter((item) => result.has(item));
}

export function capabilityCeilingFor(role: HouseholdMembership['role']): Capability[] {
  return [...roleCeilings[role]];
}

export function defaultCapabilitiesFor(role: HouseholdMembership['role']): Capability[] {
  return [...baseRoleCapabilities[role]];
}

export function hasCapability(viewer: ViewerContext, capability: Capability): boolean {
  return viewer.status === 'active' && viewer.capabilities.includes(capability);
}

export function authorize(viewer: ViewerContext, capability: Capability): AuthorizationDecision {
  if (viewer.status !== 'active') return { allowed: false, reason: 'MEMBERSHIP_INACTIVE' };
  return hasCapability(viewer, capability)
    ? { allowed: true }
    : { allowed: false, reason: 'CAPABILITY_MISSING' };
}

export function authorizeVisibleResource(
  viewer: ViewerContext,
  capability: Capability,
  visibility: VisibilityPolicy,
  relatedMembershipIds: string[] = [],
): AuthorizationDecision {
  const capabilityDecision = authorize(viewer, capability);
  if (!capabilityDecision.allowed) return capabilityDecision;
  if (viewer.role === 'owner') return { allowed: true };
  const visible = (visibility.audience === 'household' && viewer.role !== 'guest')
    || (visibility.audience === 'adults' && viewer.role === 'adult')
    || (visibility.audience === 'creator' && visibility.creatorMembershipId === viewer.membershipId)
    || (visibility.audience === 'participants' && relatedMembershipIds.includes(viewer.membershipId))
    || (visibility.audience === 'selected' && visibility.selectedMembershipIds.includes(viewer.membershipId));
  return visible ? { allowed: true } : { allowed: false, reason: 'SCOPE_DENIED' };
}

export function projectSnapshotForViewer(source: HouseholdSnapshot, viewer: ViewerContext): HouseholdSnapshot {
  const snapshot = structuredClone(source);
  snapshot.viewer = structuredClone(viewer);
  snapshot.events = snapshot.events.filter((item) => !item.deletedAt && authorizeVisibleResource(viewer, 'event.read', item.visibility, [item.ownerMembershipId, ...item.participantMembershipIds]).allowed);
  snapshot.todos = snapshot.todos.filter((item) => !item.deletedAt && authorizeVisibleResource(viewer, 'task.read', item.visibility, [item.creatorMembershipId, item.assigneeMembershipId, ...(item.reviewerMembershipId ? [item.reviewerMembershipId] : [])]).allowed);
  snapshot.memos = snapshot.memos.filter((item) => !item.deletedAt && authorizeVisibleResource(viewer, 'memo.read', item.visibility, [item.authorMembershipId]).allowed);
  snapshot.resources = snapshot.resources.filter((item) => authorizeVisibleResource(viewer, 'resource.read', item.visibility).allowed);
  if (!authorize(viewer, 'expense.read').allowed) snapshot.expenses = [];
  if (!authorize(viewer, 'household.members.read').allowed) {
    const referenced = new Set([viewer.membershipId]);
    snapshot.events.forEach((item) => { referenced.add(item.ownerMembershipId); item.participantMembershipIds.forEach((id) => referenced.add(id)); });
    snapshot.todos.forEach((item) => { referenced.add(item.creatorMembershipId); referenced.add(item.assigneeMembershipId); if (item.reviewerMembershipId) referenced.add(item.reviewerMembershipId); });
    snapshot.memos.forEach((item) => referenced.add(item.authorMembershipId));
    snapshot.memberships = snapshot.memberships.filter((item) => referenced.has(item.id));
  }
  return snapshot;
}

export function canMutateOwnedResource(
  viewer: ViewerContext,
  capability: Capability,
  ownerMembershipId: string,
): AuthorizationDecision {
  const decision = authorize(viewer, capability);
  if (!decision.allowed) return decision;
  if (viewer.role === 'owner' || viewer.role === 'adult' || ownerMembershipId === viewer.membershipId) return { allowed: true };
  return { allowed: false, reason: 'SCOPE_DENIED' };
}

export const roleLabels: Record<HouseholdMembership['role'], string> = {
  owner: '管理者', adult: '大人のメンバー', child: '子どもメンバー', guest: 'ゲスト',
};

export const membershipStatusLabels: Record<HouseholdMembership['status'], string> = {
  active: '利用中', invited: '招待中', suspended: '利用停止',
};
