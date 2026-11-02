import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHouseholdRules } from '../../../src/domain/commands';
import { loadAggregate, saveAggregate } from '../../db/aggregateStore';
import { ApiError, sendError, unauthenticated } from '../context';
import type { AppDeps } from '../context';
import { parse } from '../parse';
import { hashInviteToken } from './household';
import { serverMessages } from '../../../src/content/serverMessages';

const unusable = 'UNAUTHENTICATED' as const;
const memberColors = ['#315c80', '#a94f38', '#6f7552', '#8a6680', '#796a55', '#3f6f6a', '#8a7440', '#5b5f8a'];
const defaults = { privacy: { defaultAudience: 'household' as const, hideNotificationContent: true, placeLookupConsent: null }, notificationPreferences: { todoDue: true, eventDeparture: true, quietHours: true } };

export function registerInviteAcceptance(app: FastifyInstance, deps: AppDeps) {
  app.post('/v1/household-invites/accept', { config: { route: { operationId: 'acceptInvite', auth: 'session', csrf: true, capability: 'none', idempotent: true } } }, async (request, reply) => {
    if (!request.session) throw unauthenticated();
    const { session } = request;
    const code = parse(z.object({ code: z.string().max(200) }), request.body).code.trim();
    const token = hashInviteToken(code);
    const found = deps.db.get<{ household_id: string }>("SELECT household_id FROM records WHERE collection = 'invites' AND json_extract(body, '$.token') = ?", token);
    const rejected = { code: unusable, message: serverMessages.inviteInvalid, retryable: false };
    if (!found) return sendError(reply, rejected);
    const result = deps.db.transaction(() => {
      const member = deps.db.get<{ household_id: string; membership_id: string }>('SELECT household_id, membership_id FROM household_members WHERE user_id = ?', session.user_id);
      if (member && member.household_id !== found.household_id) return { ok: false as const, error: rejected };
      const loaded = loadAggregate(deps.db, found.household_id, member?.membership_id ?? '', defaults);
      const rules = createHouseholdRules(loaded.aggregate, { actorMembershipId: member?.membership_id ?? '', now: deps.clock.now, nextId: deps.ids.next, newInviteToken: deps.ids.inviteToken });
      const invite = loaded.aggregate.invites.find((item) => item.token === token);
      const accepted = rules.household.acceptInvite(token);
      if (!accepted.ok || !invite) return accepted;
      if (!member) {
        const user = deps.db.get<{ display_name: string }>('SELECT display_name FROM users WHERE id = ?', session.user_id);
        if (!user) throw new ApiError(401, rejected);
        const { memberships } = loaded.aggregate.state;
        const id = deps.ids.next('member');
        memberships.push({ id, householdId: found.household_id, userId: session.user_id, displayName: user.display_name, role: invite.role, status: 'active', color: memberColors[memberships.length % memberColors.length], version: 1 });
        deps.db.run('INSERT INTO household_members (user_id, household_id, membership_id) VALUES (?, ?, ?)', session.user_id, found.household_id, id);
      }
      saveAggregate(deps.db, found.household_id, member?.membership_id ?? '', loaded);
      deps.db.run('INSERT INTO audit_events (id, household_id, actor_user_id, action, target, at) VALUES (?, ?, ?, ?, ?, ?)', deps.ids.next('audit'), found.household_id, session.user_id, 'acceptInvite', invite.id, deps.clock.now());
      return accepted;
    }, (value) => value.ok);
    if (!result.ok) return sendError(reply, result.error);
    return result.value;
  });
}
