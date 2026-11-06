import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { serverMessages } from '../../src/content/serverMessages';
import { loadCommonPasswords } from '../../src/domain/passwordPolicy';
import { logKeyReport, syncKeyring } from '../auth/keyring';
import { cookieNames, csrfTokenFor, csrfTokenMatches, findSession, presessionValue } from '../auth/sessions';
import { ApiError, sendError, unauthenticated } from './context';
import type { AppDeps, RouteDeclaration } from './context';
import { registerAccountRoutes } from './routes/account';
import { registerAssistantRoutes } from './routes/assistant';
import { registerAuditRoutes } from './routes/audit';
import { registerAuthRoutes } from './routes/auth';
import { registerContentRoutes } from './routes/content';
import { registerHouseholdRoutes } from './routes/household';
import { registerMediaRoutes } from './routes/media';
import { registerOperationalRoutes } from './routes/operational';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function verifyOrigin(deps: AppDeps, request: FastifyRequest) {
  const { origin } = request.headers;
  const site = request.headers['sec-fetch-site'];
  const rejected = (origin !== undefined && origin !== deps.config.origin) || (site !== undefined && site !== 'same-origin' && site !== 'none');
  if (rejected) throw new ApiError(403, { code: 'FORBIDDEN', message: serverMessages.originRejected, retryable: false });
}

function verifyCsrf(deps: AppDeps, request: FastifyRequest) {
  const binding = request.session?.id ?? request.cookies[cookieNames(deps.config).presession];
  const presented = request.headers['x-csrf-token'];
  if (!csrfTokenMatches(deps.config, binding, typeof presented === 'string' ? presented : undefined)) {
    throw new ApiError(403, { code: 'FORBIDDEN', message: serverMessages.csrfFailed, retryable: true, reason: 'CSRF' });
  }
}

function verifyPermissionRevision(deps: AppDeps, request: FastifyRequest) {
  const expected = request.headers['if-permission-revision'];
  if (typeof expected !== 'string' || !request.actor) return;
  const row = deps.db.get<{ body: string }>("SELECT body FROM records WHERE household_id = ? AND collection = 'meta' AND id = 'permissionRevision'", request.actor.householdId);
  if (row && Number(expected) !== Number(row.body)) throw new ApiError(409, { code: 'CONFLICT', message: serverMessages.permissionChanged, retryable: false, reason: 'PERMISSION_REVISION' });
}

/** 利用できる期間かどうか。支払いの仕組みはなく、運営者が手で延ばす。 */
export function entitlementActive(deps: AppDeps, householdId: string, now: string) {
  const row = deps.db.get<{ status: string; ends_at: string | null }>('SELECT status, ends_at FROM entitlements WHERE household_id = ?', householdId);
  if (!row || row.status === 'expired') return false;
  return !row.ends_at || Date.parse(row.ends_at) > Date.parse(now);
}

async function guard(deps: AppDeps, request: FastifyRequest) {
  const declaration = request.routeOptions.config.route;
  if (!declaration) throw new ApiError(404, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false });
  const now = deps.clock.now();
  request.session = findSession(deps.db, request.cookies[cookieNames(deps.config).session], now);
  if (request.session) {
    const member = deps.db.get<{ household_id: string; membership_id: string }>('SELECT household_id, membership_id FROM household_members WHERE user_id = ?', request.session.user_id);
    request.actor = member ? { userId: request.session.user_id, householdId: member.household_id, membershipId: member.membership_id } : null;
    if (Date.parse(now) - Date.parse(request.session.last_seen_at) > 60_000) deps.db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now, request.session.id);
  }
  if (declaration.auth === 'session' && !request.session) throw unauthenticated();
  if (!safeMethods.has(request.method)) {
    verifyOrigin(deps, request);
    if (declaration.csrf) verifyCsrf(deps, request);
    verifyPermissionRevision(deps, request);
  }
  if (declaration.capability === 'rule' && request.actor && !entitlementActive(deps, request.actor.householdId, now)) {
    throw new ApiError(403, { code: 'FORBIDDEN', message: serverMessages.entitlementEnded, retryable: false, reason: 'MEMBERSHIP_INACTIVE' });
  }
  if (declaration.recentAuth) {
    const at = request.session?.reauthenticated_at;
    if (!at || Date.parse(now) - Date.parse(at) > deps.config.recentAuthMs) throw new ApiError(403, { code: 'REAUTH_REQUIRED', message: serverMessages.reauthRequired, retryable: true });
  }
}

export function csrfResponse(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  const binding = request.session?.id ?? presessionValue(request, reply, deps.config);
  return { token: csrfTokenFor(deps.config, binding) };
}

/** 宣言された経路の一覧。契約との照合に使う。 */
export const routeTable: Array<{ method: string; url: string; declaration: RouteDeclaration }> = [];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  routeTable.length = 0;
  // 鍵の指紋を記録と照らし合わせる。鍵のない暗号文があっても起動し、その人の二段階認証を「使えない」として扱う。
  logKeyReport(syncKeyring(deps.db, deps.config.keys, deps.clock.now()));
  // 監査の記録: 箱に残った行（前の版の audit_events から移したものを含む）を audit.db へ移し、直近の分の鎖を確かめる。
  // 食い違いがあっても起動は止めず、/ready も落とさない。管理者の画面（変更の記録）と運用ログに出す。
  deps.audit.verifyRecent(deps.clock.now());
  // 頻出のパスワードの一覧は、最初の要求を待たずに読み込んでおく。
  await loadCommonPasswords();
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: 'loopback', exposeHeadRoutes: false });
  await app.register(cookie);
  await app.register(multipart);
  app.decorateRequest('session', null);
  app.decorateRequest('actor', null);
  // 宣言のない経路は作らせない（既定で拒否）。
  app.addHook('onRoute', (route) => {
    if (route.method === 'OPTIONS') return;
    if (!route.config?.route) throw new Error(`route ${String(route.method)} ${route.url} has no declaration`);
    routeTable.push({ method: String(route.method), url: route.url, declaration: route.config.route });
  });
  app.addHook('preHandler', (request) => guard(deps, request));
  // API の応答は、型を推測させず、ブラウザやプロキシに残させない。配信の nginx も付けるが、API だけで動かしたときも同じにする（侵入試験 PT-HEADERS）。
  // 写真や添付の配信は、それぞれの経路で Cache-Control を決める。
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof ApiError) return sendError(reply, error.error);
    if (error.statusCode && error.statusCode < 500) return sendError(reply, { code: 'INVALID_INPUT', message: serverMessages.invalidInput, retryable: false });
    if (process.env.FAMILY_HUB_DEBUG) console.error(error);
    request.log.error(error);
    return sendError(reply, { code: 'UPSTREAM_FAILURE', message: serverMessages.unavailable, retryable: true });
  });
  app.setNotFoundHandler((_request, reply) => sendError(reply, { code: 'NOT_FOUND', message: serverMessages.notFound, retryable: false }));
  registerOperationalRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerAccountRoutes(app, deps);
  registerHouseholdRoutes(app, deps);
  registerContentRoutes(app, deps);
  registerMediaRoutes(app, deps);
  registerAssistantRoutes(app, deps);
  registerAuditRoutes(app, deps);
  return app;
}
