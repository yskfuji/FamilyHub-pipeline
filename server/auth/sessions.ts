import { createHash, randomBytes } from 'node:crypto';
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
  const row = db.get<SessionRow & { idle_timeout_minutes: number }>('SELECT s.id, s.user_id, s.label, s.location, s.created_at, s.last_seen_at, s.expires_at, s.reauthenticated_at, s.revoked_at, u.idle_timeout_minutes FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.deleted_at IS NULL', hash(token));
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.parse(nowIso)) return null;
  // 無操作の時間切れはサーバーで判定する。画面の残り時間の表示は案内にすぎない。
  if (Date.parse(nowIso) - Date.parse(row.last_seen_at) > row.idle_timeout_minutes * 60_000) { db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', nowIso, row.id); return null; }
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

/** 有効な鍵で作り、引退していないすべての鍵で確かめる（鍵を替えても開いている画面のトークンが使える）。 */
export function csrfTokenFor(config: ServerConfig, binding: string) {
  return config.keys.sign('csrf', binding);
}

export function csrfTokenMatches(config: ServerConfig, binding: string | undefined, presented: string | undefined) {
  if (!binding || !presented) return false;
  return config.keys.verify('csrf', binding, presented);
}
