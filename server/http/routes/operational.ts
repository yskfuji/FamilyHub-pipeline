import type { FastifyInstance } from 'fastify';
import { csrfResponse } from '../app';
import type { AppDeps } from '../context';

const open = (operationId: string) => ({ route: { operationId, auth: 'public', csrf: false, capability: 'none', idempotent: false } as const });

export function registerOperationalRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/health', { config: open('getHealth') }, async () => ({ status: 'ok' }));
  app.get('/ready', { config: open('getReadiness') }, async (_request, reply) => {
    try {
      deps.db.get('SELECT 1 AS ok');
      if (!(await deps.scanner.ready())) return await reply.code(503).send({ status: 'unavailable' });
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
  app.get('/v1/version', { config: open('getVersion') }, async () => ({ build: process.env.FAMILY_HUB_BUILD ?? 'development' }));
  app.get('/v1/auth/csrf', { config: open('getCsrfToken') }, async (request, reply) => reply.header('Cache-Control', 'no-store').send(csrfResponse(deps, request, reply)));
}
