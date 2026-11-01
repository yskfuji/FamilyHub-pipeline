import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addDateKeyDays } from '../../../src/domain/calendarDate';
import { holidaysBetween } from '../../../src/domain/holidays';
import { idSchema } from '../../../src/domain/schemas';
import type { Capability, MembershipRole, PermissionOverride } from '../../../src/domain/types';
import { ok } from '../../../src/domain/commands/context';
import type { AppDeps, RouteDeclaration } from '../context';
import { parse } from '../parse';
import { mutate, read } from '../rules';
import { registerInviteAcceptance } from './inviteAcceptance';

const declare = (operationId: string, overrides: Partial<RouteDeclaration> = {}) => ({ route: { operationId, auth: 'session', csrf: true, capability: 'rule', idempotent: true, ...overrides } as RouteDeclaration });
const reading = (operationId: string) => declare(operationId, { csrf: false, idempotent: false });
const param = (request: { params: unknown }, name: string) => parse(idSchema, (request.params as Record<string, unknown>)[name]);

export const hashInviteToken = (token: string) => createHash('sha256').update(`invite:${token}`).digest('base64url');

const roleBody = z.object({ role: z.enum(['owner', 'adult', 'child', 'guest']), expectedVersion: z.number().int() });
const inviteBody = z.object({ role: z.enum(['adult', 'child', 'guest']) });
const overridesBody = z.object({ overrides: z.array(z.object({ membershipId: idSchema, capability: z.string(), effect: z.enum(['allow', 'deny']) })), expectedPermissionRevision: z.number().int() });

export function registerHouseholdRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/v1/households/current/snapshot', { config: reading('getHouseholdSnapshot') }, (request, reply) => read(deps, request, reply, (rules) => {
    const snapshot = rules.context.project();
    const now = deps.clock.now();
    snapshot.context.asOf = now;
    snapshot.context.sync = { state: 'synced', lastSyncedAt: now };
    snapshot.context.weather = deps.weather.current();
    snapshot.context.holidays = holidaysBetween(now.slice(0, 10), addDateKeyDays(now.slice(0, 10), 400));
    return ok(snapshot);
  }));
  app.patch('/v1/households/current', { config: declare('updateHouseholdProfile', { recentAuth: true }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.household.updateProfile(request.body as never)));
  app.get('/v1/households/current/privacy', { config: reading('getPrivacySettings') }, (request, reply) => read(deps, request, reply, (rules) => rules.household.getPrivacySettings()));
  app.put('/v1/households/current/privacy', { config: declare('savePrivacySettings') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.household.savePrivacySettings(request.body as never)));
  app.patch('/v1/household-memberships/:membershipId', { config: declare('updateMembershipRole', { recentAuth: true }) }, (request, reply) => {
    const body = parse(roleBody, request.body);
    return mutate(deps, request, reply, (rules) => rules.household.updateMembershipRole(param(request, 'membershipId'), body.role as MembershipRole, body.expectedVersion));
  });
  app.get('/v1/household-memberships/:membershipId/permission-overrides', { config: reading('getPermissionOverrides') }, (request, reply) => read(deps, request, reply, (rules) => rules.household.getPermissionOverrides(param(request, 'membershipId'))));
  app.put('/v1/household-memberships/:membershipId/permission-overrides', { config: declare('updatePermissionOverrides', { recentAuth: true }) }, (request, reply) => {
    const body = parse(overridesBody, request.body);
    return mutate(deps, request, reply, (rules) => rules.household.updatePermissionOverrides(param(request, 'membershipId'), body.overrides as PermissionOverride[] & { capability: Capability }[], body.expectedPermissionRevision));
  });
  app.delete('/v1/household-memberships/:membershipId/permission-overrides', { config: declare('resetPermissionOverrides', { recentAuth: true }) }, (request, reply) => {
    const expected = parse(z.coerce.number().int(), (request.query as Record<string, unknown>).expectedPermissionRevision);
    return mutate(deps, request, reply, (rules) => rules.household.resetPermissionOverrides(param(request, 'membershipId'), expected));
  });
  app.get('/v1/household-invites', { config: reading('listHouseholdInvites') }, (request, reply) => read(deps, request, reply, (rules) => rules.household.listInvites()));
  app.post('/v1/household-invites', { config: declare('createHouseholdInvite', { recentAuth: true, successStatus: 201 }) }, (request, reply) => {
    const body = parse(inviteBody, request.body);
    return mutate(deps, request, reply, (rules) => {
      const created = rules.household.createInvite(body.role);
      if (!created.ok) return created;
      // コードそのものは保存しない。発行の応答でだけ本人に渡す。
      const stored = rules.context.a.invites.find((item) => item.id === created.value.id);
      if (stored?.token) stored.token = hashInviteToken(stored.token);
      return created;
    });
  });
  app.delete('/v1/household-invites/:inviteId', { config: declare('revokeHouseholdInvite', { recentAuth: true }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.household.revokeInvite(param(request, 'inviteId'))));
  registerInviteAcceptance(app, deps);
  app.post('/v1/households/current/ownership', { config: declare('transferOwnership', { recentAuth: true }) }, (request, reply) => {
    const body = parse(z.object({ toMembershipId: idSchema, expectedVersion: z.number().int() }), request.body);
    return mutate(deps, request, reply, (rules) => {
      const target = rules.context.state.memberships.find((item) => item.id === body.toMembershipId);
      const adult = target && deps.db.get<{ adult_declared_at: string | null }>('SELECT adult_declared_at FROM users WHERE id = ?', target.userId);
      if (target && !adult?.adult_declared_at) return { ok: false, error: { code: 'INVALID_INPUT', message: '管理者は、18歳以上と確認できた人にだけ渡せます。', retryable: false } };
      return rules.family.transferOwnership(body.toMembershipId, body.expectedVersion);
    });
  });
  app.post('/v1/households/current/leave', { config: declare('leaveHousehold', { recentAuth: true }) }, (request, reply) => mutate(deps, request, reply, (rules) => {
    const result = rules.family.leaveHousehold();
    if (result.ok) deps.db.run('DELETE FROM household_members WHERE membership_id = ?', rules.context.env.actorMembershipId);
    return result;
  }));
  app.put('/v1/household-memberships/:membershipId/status', { config: declare('setMemberStatus', { recentAuth: true }) }, (request, reply) => {
    const body = parse(z.object({ status: z.enum(['active', 'suspended']), expectedVersion: z.number().int() }), request.body);
    return mutate(deps, request, reply, (rules) => rules.family.setMemberStatus(param(request, 'membershipId'), body.status, body.expectedVersion));
  });
  app.delete('/v1/household-memberships/:membershipId', { config: declare('removeMember', { recentAuth: true }) }, (request, reply) => {
    const expected = parse(z.coerce.number().int(), (request.query as Record<string, unknown>).expectedVersion);
    const id = param(request, 'membershipId');
    return mutate(deps, request, reply, (rules) => {
      const result = rules.family.removeMember(id, expected);
      if (result.ok) deps.db.run('DELETE FROM household_members WHERE membership_id = ?', id);
      return result;
    });
  });
  app.post('/v1/color-labels', { config: declare('createColorLabel', { successStatus: 201 }) }, (request, reply) => mutate(deps, request, reply, (rules) => rules.family.createColorLabel(request.body as never)));
  app.put('/v1/color-labels/:labelId', { config: declare('updateColorLabel') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.family.updateColorLabel(param(request, 'labelId'), request.body as never)));
  app.delete('/v1/color-labels/:labelId', { config: declare('deleteColorLabel') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.family.deleteColorLabel(param(request, 'labelId'))));
  const itemRef = z.strictObject({ kind: z.enum(['event', 'task', 'memo', 'expense']), id: idSchema });
  app.post('/v1/item-links', { config: declare('createItemLink', { successStatus: 201 }) }, (request, reply) => {
    const body = parse(z.object({ from: itemRef, to: itemRef }), request.body);
    return mutate(deps, request, reply, (rules) => rules.links.createLink(body.from, body.to));
  });
  app.delete('/v1/item-links/:linkId', { config: declare('deleteItemLink') }, (request, reply) => mutate(deps, request, reply, (rules) => rules.links.deleteLink(param(request, 'linkId'))));
  app.get('/v1/recently-deleted', { config: reading('listRecentlyDeleted') }, (request, reply) => read(deps, request, reply, (rules) => rules.trash.list(), { media: true }));
}
