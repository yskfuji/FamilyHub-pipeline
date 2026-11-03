import type { FastifyInstance } from 'fastify';
import { accountAuditRequest, presentAccountAudit } from '../../../src/domain/commands/audit';
import { requireActor, sendError, unauthenticated } from '../context';
import type { AppDeps, RouteDeclaration } from '../context';
import { read } from '../rules';

const reading = (operationId: string, capability: RouteDeclaration['capability']) => ({ route: { operationId, auth: 'session', csrf: false, capability, idempotent: false } as RouteDeclaration });

/**
 * 変更の記録を読む経路。家族の記録は audit.read（既定では管理者だけ）、アカウントの記録は本人だけが読む。
 * 応答には本文・秘密・トークン・IP を入れない。見られない記録を指す行は ID を伏せる（src/domain/commands/audit.ts）。
 */
export function registerAuditRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/v1/audit-events', { config: reading('listAuditEvents', 'rule') }, (request, reply) => read(deps, request, reply, (rules) => {
    const parsed = rules.audit.request(request.query as Record<string, unknown>);
    if (!parsed.ok) return parsed;
    // 確定の直後に移しそこねた行があれば、読む前に移す。
    deps.audit.flush();
    const { filter, cursor, limit } = parsed.value;
    const rows = deps.audit.store.listHousehold(requireActor(request).householdId, filter, cursor, limit + 1);
    const { state, checkedAt } = deps.audit.status;
    return rules.audit.present(rows, limit, { state, checkedAt });
  }, { media: true }));

  app.get('/v1/account/audit-events', { config: reading('listAccountAuditEvents', 'own') }, (request, reply) => {
    if (!request.session) throw unauthenticated();
    const parsed = accountAuditRequest(request.query as Record<string, unknown>);
    if (!parsed.ok) return sendError(reply, parsed.error);
    deps.audit.flush();
    const rows = deps.audit.store.listAccount(request.session.user_id, parsed.value.cursor, parsed.value.limit + 1);
    return reply.send(presentAccountAudit(rows, parsed.value.limit));
  });
}
