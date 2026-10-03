import { describe, expect, it } from 'vitest';
import { authorizeVisibleResource, capabilitiesFor, capabilityCeilingFor, projectSnapshotForViewer, redactPlace } from './policy';
import type { PermissionOverride, ViewerContext, VisibilityPolicy } from '../domain/types';
import { baseSnapshot } from '../data/fixtures';

const viewer = (role: ViewerContext['role'], membershipId = `member-${role}`, overrides: PermissionOverride[] = []): ViewerContext => ({
  userId: `user-${role}`, membershipId, role, status: 'active', capabilities: capabilitiesFor(role, overrides), permissionRevision: 1,
});

describe('authorization policy', () => {
  it('keeps administration owner-only and applies deny before role defaults', () => {
    expect(capabilitiesFor('owner')).toContain('household.members.manage');
    expect(capabilityCeilingFor('adult')).not.toContain('household.members.manage');
    expect(capabilitiesFor('adult', [{ membershipId: 'member-adult', capability: 'event.delete', effect: 'deny' }])).not.toContain('event.delete');
  });

  it('never lets a child override the role ceiling', () => {
    expect(capabilitiesFor('child')).not.toContain('expense.read');
    expect(capabilitiesFor('child', [{ membershipId: 'member-child', capability: 'expense.read', effect: 'allow' }])).not.toContain('expense.read');
    expect(capabilitiesFor('child', [{ membershipId: 'member-child', capability: 'insight.read', effect: 'allow' }])).not.toContain('insight.read');
    expect(capabilitiesFor('child', [{ membershipId: 'member-child', capability: 'household.members.manage', effect: 'allow' }])).not.toContain('household.members.manage');
  });

  it('requires both a capability and resource visibility', () => {
    const visibility: VisibilityPolicy = { audience: 'selected', creatorMembershipId: 'member-owner', selectedMembershipIds: ['member-child'] };
    expect(authorizeVisibleResource(viewer('child', 'member-child'), 'event.read', visibility).allowed).toBe(true);
    expect(authorizeVisibleResource(viewer('guest', 'member-guest'), 'event.read', visibility)).toEqual({ allowed: false, reason: 'SCOPE_DENIED' });
  });

  it('does not let the owner role bypass private visibility and requires explicit sharing for guests', () => {
    const household: VisibilityPolicy = { audience: 'household', creatorMembershipId: 'member-owner', selectedMembershipIds: [] };
    expect(authorizeVisibleResource(viewer('owner'), 'event.read', { ...household, creatorMembershipId: 'member-child', audience: 'creator' })).toEqual({ allowed: false, reason: 'SCOPE_DENIED' });
    expect(authorizeVisibleResource(viewer('owner'), 'event.read', { ...household, creatorMembershipId: 'member-child', audience: 'selected' })).toEqual({ allowed: false, reason: 'SCOPE_DENIED' });
    expect(authorizeVisibleResource(viewer('guest'), 'resource.read', household)).toEqual({ allowed: false, reason: 'SCOPE_DENIED' });
    expect(authorizeVisibleResource(viewer('child'), 'event.read', { ...household, creatorMembershipId: 'member-adult' })).toEqual({ allowed: false, reason: 'SCOPE_DENIED' });
  });

  it('projects protected collections before rendering a role-specific snapshot', () => {
    const child = viewer('child', 'member-hana');
    const projected = projectSnapshotForViewer(baseSnapshot, child);
    expect(projected.events.map((item) => item.id)).toContain('event-school');
    expect(projected.events.map((item) => item.id)).not.toContain('event-piano');
    const guest = projectSnapshotForViewer(baseSnapshot, viewer('guest', 'member-yui'));
    expect(guest.resources.map((item) => item.id)).toEqual(['resource-school', 'resource-guide']);
    expect(guest.expenses).toEqual([]);
  });

  it('shows recorded places only to owners and adults, field by field', () => {
    const placeOf = (snapshot: ReturnType<typeof projectSnapshotForViewer>) => snapshot.memos.find((memo) => memo.id === 'memo-school')?.place;
    expect(placeOf(projectSnapshotForViewer(baseSnapshot, viewer('owner', 'member-aoi')))?.name).toBe('青葉小学校 体育館');
    expect(placeOf(projectSnapshotForViewer(baseSnapshot, viewer('adult', 'member-ren')))?.name).toBe('青葉小学校 体育館');
    const child = projectSnapshotForViewer(baseSnapshot, viewer('child', 'member-hana'));
    expect(child.memos.find((memo) => memo.id === 'memo-school')).toBeDefined();
    expect(placeOf(child)).toBeUndefined();
    expect(JSON.stringify(child)).not.toContain('青葉小学校 体育館');
  });

  it('lets an owner withhold places from a specific adult but never grants them to children or guests', () => {
    const restricted = viewer('adult', 'member-ren', [{ membershipId: 'member-ren', capability: 'place.read', effect: 'deny' }]);
    const snapshot = projectSnapshotForViewer(baseSnapshot, restricted);
    expect(snapshot.memos.some((memo) => memo.place)).toBe(false);
    expect(snapshot.expenses.some((expense) => expense.place)).toBe(false);
    expect(capabilityCeilingFor('child')).not.toContain('place.read');
    expect(capabilitiesFor('child', [{ membershipId: 'member-child', capability: 'place.read', effect: 'allow' }])).not.toContain('place.read');
    expect(capabilitiesFor('guest', [{ membershipId: 'member-guest', capability: 'place.read', effect: 'allow' }])).not.toContain('place.read');
  });

  it('returns the same object when nothing needs to be removed', () => {
    const memo = baseSnapshot.memos[0];
    expect(redactPlace(memo, viewer('owner', 'member-aoi'))).toBe(memo);
    expect(redactPlace(memo, viewer('child', 'member-hana'))).not.toHaveProperty('place');
  });
});
