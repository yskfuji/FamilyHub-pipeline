import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serverMessages } from '../../../src/content/serverMessages';
import { idSchema, passwordSchema } from '../../../src/domain/schemas';
import { hashPassword, verifyPassword } from '../../auth/password';
import { beginAuthentication, beginRegistration, finishAuthentication, finishRegistration } from '../../auth/passkeys';
import { clearSessionCookie, createSession, issueSessionCookie } from '../../auth/sessions';
import { sendError, unauthenticated } from '../context';
import type { AppDeps, RouteDeclaration } from '../context';
import { parse } from '../parse';
import { limit } from '../rateLimit';
import { verifySecondFactor } from './account';
import { entitlementActive } from '../app';

const declare = (operationId: string, overrides: Partial<RouteDeclaration> = {}) => ({ route: { operationId, auth: 'session', csrf: true, capability: 'own', idempotent: false, ...overrides } as RouteDeclaration });
const anonymous = (operationId: string) => declare(operationId, { auth: 'public', capability: 'none' });

const rejected = { code: 'UNAUTHENTICATED' as const, message: serverMessages.signInFailed, retryable: false };

interface UserRow { id: string; email: string; display_name: string; password_hash: string | null; totp_enabled_at: string | null }

const deviceLabel = (request: FastifyRequest) => {
  const agent = request.headers['user-agent'] ?? '';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'ブラウザ';
  const device = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Macintosh/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : '';
  return [device, browser].filter(Boolean).join(' ');
};

function startSession(deps: AppDeps, request: FastifyRequest, reply: FastifyReply, userId: string) {
  // サインインのたびに新しい値にする（固定化を防ぐ）。CSRF トークンも結び直される。
  issueSessionCookie(reply, deps.config, createSession(deps.db, deps.config, userId, deps.clock.now(), deviceLabel(request), deps.ids.next('session')));
  deps.db.run('INSERT INTO audit_events (id, actor_user_id, action, at) VALUES (?, ?, ?, ?)', deps.ids.next('audit'), userId, 'signIn', deps.clock.now());
}

function sessionStage(deps: AppDeps, request: FastifyRequest) {
  if (!request.actor) return 'household-setup' as const;
  const row = deps.db.get<{ body: string }>("SELECT body FROM records WHERE household_id = ? AND collection = 'memberships' AND id = ?", request.actor.householdId, request.actor.membershipId);
  if (row && (JSON.parse(row.body) as { status: string }).status === 'suspended') return 'suspended' as const;
  return entitlementActive(deps, request.actor.householdId, deps.clock.now()) ? 'active' as const : 'paywall' as const;
}

const currentUser = (deps: AppDeps, request: FastifyRequest) => {
  if (!request.session) throw unauthenticated();
  const user = deps.db.get<UserRow>('SELECT id, email, display_name, password_hash, totp_enabled_at FROM users WHERE id = ? AND deleted_at IS NULL', request.session.user_id);
  if (!user) throw unauthenticated();
  return user;
};

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post('/v1/auth/password', { config: anonymous('signInWithPassword') }, async (request, reply) => {
    const { email, password } = parse(z.object({ email: z.string().max(254), password: z.string().max(200) }), request.body);
    const user = deps.db.get<UserRow>('SELECT id, email, display_name, password_hash, totp_enabled_at FROM users WHERE email = ? AND deleted_at IS NULL', email.trim());
    limit(deps, `sign-in:${request.ip}`, 50, 900_000);
    limit(deps, `sign-in:${email.trim().toLowerCase()}`, 10, 900_000);
    const matched = await verifyPassword(password, user?.password_hash);
    if (!user || !matched) return sendError(reply, rejected);
    if (user.totp_enabled_at) {
      const challengeId = deps.ids.next('totp');
      deps.db.run("INSERT INTO webauthn_challenges (id, purpose, user_id, challenge, expires_at) VALUES (?, 'totp', ?, '', ?)", challengeId, user.id, new Date(Date.parse(deps.clock.now()) + 300_000).toISOString());
      return { totpChallengeId: challengeId };
    }
    startSession(deps, request, reply, user.id);
    return { userId: user.id };
  });
  app.post('/v1/auth/totp/verify', { config: anonymous('verifyTotp') }, async (request, reply) => {
    const body = parse(z.object({ challengeId: idSchema, code: z.string().max(20) }), request.body);
    limit(deps, `totp-sign-in:${body.challengeId}`, 5, 300_000);
    const challenge = deps.db.get<{ user_id: string; expires_at: string }>("SELECT user_id, expires_at FROM webauthn_challenges WHERE id = ? AND purpose = 'totp'", body.challengeId);
    const user = challenge ? deps.db.get<UserRow & { id: string; totp_secret: string | null; totp_last_step: number | null }>('SELECT id, email, display_name, password_hash, totp_enabled_at, totp_secret, totp_last_step FROM users WHERE id = ?', challenge.user_id) : undefined;
    if (!challenge || !user || Date.parse(challenge.expires_at) <= Date.parse(deps.clock.now()) || !verifySecondFactor(deps, user, body.code)) return sendError(reply, { code: 'UNAUTHENTICATED', message: serverMessages.totpInvalid, retryable: true });
    deps.db.run('DELETE FROM webauthn_challenges WHERE id = ?', body.challengeId);
    startSession(deps, request, reply, user.id);
    return { userId: user.id };
  });
  app.post('/v1/auth/passkey/challenge', { config: anonymous('beginPasskey') }, () => beginAuthentication(deps));
  app.post('/v1/auth/passkey/complete', { config: anonymous('finishPasskey') }, async (request, reply) => {
    const body = parse(z.object({ challengeId: idSchema, assertion: z.record(z.string(), z.unknown()) }), request.body);
    const userId = await finishAuthentication(deps, body.challengeId, body.assertion as unknown as AuthenticationResponseJSON);
    if (!userId) return sendError(reply, { code: 'UNAUTHENTICATED', message: serverMessages.passkeyFailed, retryable: true });
    startSession(deps, request, reply, userId);
    return { userId };
  });
  app.get('/v1/auth/session', { config: declare('getSession', { auth: 'public', csrf: false, capability: 'none' }) }, (request) => {
    if (!request.session) return { stage: 'signed-out' as const, idleTimeoutMinutes: 30 };
    const row = deps.db.get<{ idle_timeout_minutes: number }>('SELECT idle_timeout_minutes FROM users WHERE id = ?', request.session.user_id);
    return { stage: sessionStage(deps, request), userId: request.session.user_id, idleTimeoutMinutes: row?.idle_timeout_minutes ?? 30 };
  });
  app.delete('/v1/auth/session', { config: declare('signOut', { capability: 'none' }) }, (request, reply) => {
    if (request.session) deps.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', deps.clock.now(), request.session.id);
    clearSessionCookie(reply, deps.config);
    return reply.code(204).send();
  });
  app.get('/v1/auth/security', { config: declare('getSecurityOverview', { csrf: false }) }, (request) => {
    const user = currentUser(deps, request);
    const passkeys = deps.db.all<{ id: string; label: string; created_at: string }>('SELECT id, label, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at', user.id);
    const sessions = deps.db.all<{ id: string; label: string; location: string; last_seen_at: string }>('SELECT id, label, location, last_seen_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND unixepoch(expires_at) > unixepoch(?) ORDER BY unixepoch(last_seen_at) DESC', user.id, deps.clock.now());
    return {
      authenticators: passkeys.map((item) => ({ id: item.id, label: item.label, createdAt: item.created_at, kind: 'passkey' as const, demo: false })),
      sessions: sessions.map((item) => ({ id: item.id, label: item.label, location: item.location, lastSeenAt: item.last_seen_at, current: item.id === request.session?.id })),
    };
  });
  app.post('/v1/auth/passkeys/registration', { config: declare('beginPasskeyRegistration') }, (request) => {
    const user = currentUser(deps, request);
    return beginRegistration(deps, { id: user.id, email: user.email, displayName: user.display_name });
  });
  app.post('/v1/auth/passkeys/registration/complete', { config: declare('finishPasskeyRegistration') }, async (request, reply) => {
    const user = currentUser(deps, request);
    const body = parse(z.object({ challengeId: idSchema, credential: z.record(z.string(), z.unknown()) }), request.body);
    const created = await finishRegistration(deps, user.id, body.challengeId, body.credential as unknown as RegistrationResponseJSON);
    if (!created) return sendError(reply, { code: 'INVALID_INPUT', message: serverMessages.passkeyRegistrationFailed, retryable: true });
    return reply.code(201).send(created);
  });
  app.post('/v1/auth/password/change', { config: declare('changePassword') }, async (request, reply) => {
    const user = currentUser(deps, request);
    const body = parse(z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }), request.body);
    if (!(await verifyPassword(body.currentPassword, user.password_hash))) return sendError(reply, { code: 'UNAUTHENTICATED', message: serverMessages.currentPasswordWrong, retryable: false });
    const parsed = passwordSchema.safeParse(body.newPassword);
    if (!parsed.success) return sendError(reply, { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? serverMessages.invalidInput, retryable: false });
    const hashed = await hashPassword(parsed.data);
    deps.db.transaction(() => {
      deps.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashed, user.id);
      // ほかの端末のサインインを終わらせる。
      deps.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', deps.clock.now(), user.id, request.session?.id ?? '');
      deps.db.run('INSERT INTO audit_events (id, actor_user_id, action, at) VALUES (?, ?, ?, ?)', deps.ids.next('audit'), user.id, 'changePassword', deps.clock.now());
    });
    return reply.code(204).send();
  });
  app.delete('/v1/auth/sessions/:sessionId', { config: declare('revokeSession') }, (request, reply) => {
    const user = currentUser(deps, request);
    const sessionId = parse(idSchema, (request.params as Record<string, unknown>).sessionId);
    const target = deps.db.get<{ id: string }>('SELECT id FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL', sessionId, user.id);
    if (!target || target.id === request.session?.id) return sendError(reply, { code: 'FORBIDDEN', message: serverMessages.sessionNotRevocable, retryable: false });
    deps.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', deps.clock.now(), target.id);
    return reply.code(204).send();
  });
}
