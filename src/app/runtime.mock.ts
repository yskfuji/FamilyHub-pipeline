import { capabilitiesFor, projectSnapshotForViewer } from '../authz/policy';
import { baseSnapshot, seededSnapshot, withCoOwner } from '../data/fixtures';
import { createMockGateway } from '../data/mockGateway';
import type { HouseholdSnapshot } from '../domain/types';
import type { AppRuntime } from './runtime';

function queryActor() {
  const requested = new URLSearchParams(window.location.search).get('actor');
  const auditSurface = import.meta.env.VITE_INCLUDE_AUDIT_SURFACE === 'true';
  return auditSurface && baseSnapshot.memberships.some((item) => item.id === requested) ? requested! : 'member-aoi';
}

/** 内部監査のビルドで ?household=two-owners を付けると、管理者が2人の家族で動かす（退出の確認用）。 */
function queryCoOwner() {
  return import.meta.env.VITE_INCLUDE_AUDIT_SURFACE === 'true' && new URLSearchParams(window.location.search).get('household') === 'two-owners';
}

function initialSnapshot(actorId: string, coOwner: boolean): HouseholdSnapshot {
  let snapshot = coOwner ? withCoOwner(seededSnapshot()) : seededSnapshot();
  const member = snapshot.memberships.find((item) => item.id === actorId) ?? snapshot.memberships[0];
  const viewer = { userId: member.userId, membershipId: member.id, role: member.role, status: member.status, capabilities: capabilitiesFor(member.role), permissionRevision: 1 } as HouseholdSnapshot['viewer'];
  snapshot = projectSnapshotForViewer(snapshot, viewer);
  snapshot.user = { ...snapshot.user, id: member.userId, displayName: member.displayName, email: `${member.userId}@example.test` };
  return snapshot;
}

export function createMockRuntime(): AppRuntime {
  const actorId = queryActor();
  const coOwner = queryCoOwner();
  return { mode: 'mock', actorId, gateway: createMockGateway(actorId, { coOwner, auditHistory: true }), initialSnapshot: initialSnapshot(actorId, coOwner), initialSession: { stage: 'active', idleTimeoutMinutes: 30 }, setPermissionRevision: () => undefined };
}
