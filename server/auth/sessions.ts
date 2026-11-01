import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../config';
import type { Db } from '../db/db';

export interface SessionRow { id: string; user_id: string; label: string; location: string; created_at: string; last_seen_at: string; expires_at: string; reauthenticated_at: string | null; revoked_at: string | null }

const hash = (token: string) => createHash('sha256').update(token).digest('base64url');

export const cookieNames = (config: ServerConfig) => config.secureCookies
  ? { session: '__Host-fh_session', presession: '__Host-fh_pre' }
  : { session: 'fh_session', presession: 'fh_pre' };

/** Cookie はこのファイルだけが発行する。 */
function setCookie(reply: FastifyReply, config: ServerConfig, name: string, value: string, maxAge?: number) {
  reply.setCookie(name, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies, ...(maxAge === undefined ? {} : { maxAge }) });
}

export function clearSessionCookie(reply: FastifyReply, config: ServerConfig) {
  reply.clearCookie(cookieNames(config).session, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookies });
}

export function createSession(db: Db, config: ServerConfig, userId: string, nowIso: string, label: string, id: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.parse(nowIso) + config.sessionDays * 86_400_000).toISOString();
  db.run('INSERT INTO sessions (id, token_hash, user_id, label, location, created_at, last_seen_at, expires_at, reauthenticated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, hash(token), userId, label, '', nowIso, nowIso, expires, nowIso);
  return token;
}

export function issueSessionCookie(reply: FastifyReply, config: ServerConfig, token: string) {
  setCookie(reply, config, cookieNames(config).session, token, config.sessionDays * 86_400);
}

export function findSession(db: Db, token: string | undefined, nowIso: string): SessionRow | null {
  if (!token) return null;
  const row = db.get<SessionRow>('SELECT id, user_id, label, location, created_at, last_seen_at, expires_at, reauthenticated_at, revoked_at FROM sessions WHERE token_hash = ?', hash(token));
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.parse(nowIso)) return null;
  return row;
}

/** サインイン前の操作にも CSRF トークンを結ぶための値。Cookie になければ発行する。 */
export function presessionValue(request: FastifyRequest, reply: FastifyReply, config: ServerConfig) {
  const name = cookieNames(config).presession;
  const existing = request.cookies[name];
  if (existing) return existing;
  const value = randomBytes(24).toString('base64url');
  setCookie(reply, config, name, value);
  return value;
}

export function csrfTokenFor(config: ServerConfig, binding: string) {
  return createHmac('sha256', config.secret).update(`csrf:${binding}`).digest('base64url');
}

export function csrfTokenMatches(config: ServerConfig, binding: string | undefined, presented: string | undefined) {
  if (!binding || !presented) return false;
  const expected = Buffer.from(csrfTokenFor(config, binding));
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
