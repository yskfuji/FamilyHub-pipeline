import type {
  AuthorizationDecision,
  Capability,
  HouseholdMembership,
  HouseholdSnapshot,
  LinkedItemRef,
  PermissionOverride,
  PlaceRef,
  ViewerContext,
  VisibilityAudience,
  VisibilityPolicy,
} from '../domain/types';

export const allCapabilities: Capability[] = [
  'household.members.read', 'household.members.manage', 'household.invites.manage',
  'event.read', 'event.create', 'event.update', 'event.delete',
  'task.read', 'task.create', 'task.update', 'task.delete', 'task.transition',
  'memo.read', 'memo.create', 'memo.update', 'memo.delete', 'memo.attach',
  'expense.read', 'expense.create', 'expense.update', 'expense.delete', 'expense.settle',
  'album.read', 'album.create', 'album.update', 'album.delete',
  'link.manage', 'assistant.use',
  'place.read',
  'insight.read', 'resource.read', 'settings.own', 'notification.manage',
];

const roleCeilings: Record<HouseholdMembership['role'], readonly Capability[]> = {
  owner: allCapabilities,
  adult: allCapabilities.filter((item) => !item.startsWith('household.') || item === 'household.members.read'),
  child: [
    'event.read', 'event.create', 'event.update', 'event.delete',
    'task.read', 'task.create', 'task.update', 'task.delete', 'task.transition',
    'memo.read', 'memo.create', 'memo.update', 'memo.delete', 'memo.attach',
    'album.read', 'album.create', 'album.update', 'album.delete',
    'resource.read', 'settings.own', 'notification.manage',
  ],
  guest: ['event.read', 'task.read', 'memo.read', 'album.read', 'resource.read', 'settings.own', 'notification.manage'],
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
  const isCreator = visibility.creatorMembershipId === viewer.membershipId;
  const isRelated = relatedMembershipIds.includes(viewer.membershipId);
  const visible = (visibility.audience === 'household' && (viewer.role === 'owner' || viewer.role === 'adult' || isCreator || isRelated))
    || (visibility.audience === 'adults' && (viewer.role === 'owner' || viewer.role === 'adult'))
    || (visibility.audience === 'creator' && visibility.creatorMembershipId === viewer.membershipId)
    || (visibility.audience === 'participants' && (isCreator || isRelated))
    || (visibility.audience === 'selected' && (isCreator || visibility.selectedMembershipIds.includes(viewer.membershipId)));
  return visible ? { allowed: true } : { allowed: false, reason: 'SCOPE_DENIED' };
}

/** 記録した場所は place.read を持つ人にだけ返す。持たない人には項目ごと取り除いた複製を返す。 */
export function redactPlace<T extends { place?: PlaceRef }>(item: T, viewer: ViewerContext): T {
  if (item.place === undefined || authorize(viewer, 'place.read').allowed) return item;
  const redacted = { ...item };
  delete redacted.place;
  return redacted;
}

const canSeeItem = (snapshot: HouseholdSnapshot, viewer: ViewerContext, item: LinkedItemRef) => {
  if (item.kind === 'event') return snapshot.events.some((entry) => entry.id === item.id);
  if (item.kind === 'task') return snapshot.todos.some((entry) => entry.id === item.id);
  if (item.kind === 'memo') return snapshot.memos.some((entry) => entry.id === item.id);
  return authorize(viewer, 'expense.read').allowed && snapshot.expenses.some((entry) => entry.id === item.id);
};

type Projector = (snapshot: HouseholdSnapshot, viewer: ViewerContext) => void;
const unchanged: Projector = () => undefined;

/**
 * スナップショットの項目ごとの公開の規則。項目を増やすと、ここに規則を書くまで型の検査が通らない。
 * 上から順に適用する。links と memberships は、ほかの項目の絞り込みの結果を使うので最後に置く。
 */
const snapshotProjection: Record<keyof HouseholdSnapshot, Projector> = {
  viewer: (snapshot, viewer) => { snapshot.viewer = structuredClone(viewer); },
  permissionOverrides: (snapshot, viewer) => { if (viewer.role !== 'owner') snapshot.permissionOverrides = []; },
  user: unchanged,
  household: unchanged,
  context: unchanged,
  colorLabels: unchanged,
  events: (snapshot, viewer) => { snapshot.events = snapshot.events.filter((item) => !item.deletedAt && authorizeVisibleResource(viewer, 'event.read', item.visibility, [item.ownerMembershipId, ...item.participantMembershipIds]).allowed); },
  todos: (snapshot, viewer) => { snapshot.todos = snapshot.todos.filter((item) => !item.deletedAt && authorizeVisibleResource(viewer, 'task.read', item.visibility, [item.creatorMembershipId, item.assigneeMembershipId, ...(item.reviewerMembershipId ? [item.reviewerMembershipId] : [])]).allowed); },
  memos: (snapshot, viewer) => { snapshot.memos = snapshot.memos.filter((item) => !item.deletedAt && authorizeVisibleResource(viewer, 'memo.read', item.visibility, [item.authorMembershipId]).allowed).map((item) => redactPlace(item, viewer)); },
  resources: (snapshot, viewer) => { snapshot.resources = snapshot.resources.filter((item) => authorizeVisibleResource(viewer, 'resource.read', item.visibility).allowed); },
  expenses: (snapshot, viewer) => { snapshot.expenses = snapshot.expenses.filter((item) => !item.deletedAt && authorizeVisibleResource(viewer, 'expense.read', item.visibility, [item.creatorMembershipId, item.payerMembershipId, ...item.shares.map((share) => share.membershipId)]).allowed).map((item) => redactPlace(item, viewer)); },
  links: (snapshot, viewer) => { snapshot.links = snapshot.links.filter((link) => canSeeItem(snapshot, viewer, link.from) && canSeeItem(snapshot, viewer, link.to)); },
  memberships: (snapshot, viewer) => {
    if (authorize(viewer, 'household.members.read').allowed) return;
    const referenced = new Set([viewer.membershipId]);
    snapshot.events.forEach((item) => { referenced.add(item.ownerMembershipId); item.participantMembershipIds.forEach((id) => referenced.add(id)); });
    snapshot.todos.forEach((item) => { referenced.add(item.creatorMembershipId); referenced.add(item.assigneeMembershipId); if (item.reviewerMembershipId) referenced.add(item.reviewerMembershipId); });
    snapshot.memos.forEach((item) => referenced.add(item.authorMembershipId));
    snapshot.expenses.forEach((item) => { referenced.add(item.payerMembershipId); referenced.add(item.creatorMembershipId); item.shares.forEach((share) => referenced.add(share.membershipId)); });
    snapshot.memberships = snapshot.memberships.filter((item) => referenced.has(item.id));
  },
};

export function projectSnapshotForViewer(source: HouseholdSnapshot, viewer: ViewerContext): HouseholdSnapshot {
  const snapshot = structuredClone(source);
  for (const project of Object.values(snapshotProjection)) project(snapshot, viewer);
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

/**
 * 削除と復元の規則。関わっている人だけができ、管理者でも関わりのない記録は消せない。
 * stakeholderIds は記録の種類ごとの関係者（作った人、参加者、担当者、支払った人など）。
 */
export function canDeleteResource(viewer: ViewerContext, capability: Capability, stakeholderIds: readonly string[]): AuthorizationDecision {
  const decision = authorize(viewer, capability);
  if (!decision.allowed) return decision;
  return stakeholderIds.includes(viewer.membershipId) ? { allowed: true } : { allowed: false, reason: 'SCOPE_DENIED' };
}

const allAudiences: readonly VisibilityAudience[] = ['household', 'adults', 'participants', 'creator', 'selected'];

/** 自分で選べる公開範囲。子どもメンバーは家族全体や大人向けの範囲を選べない。 */
export function allowedAudiencesFor(role: HouseholdMembership['role']): readonly VisibilityAudience[] {
  return role === 'child' ? ['participants', 'creator', 'selected'] : allAudiences;
}
