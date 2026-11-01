import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toJstRfc3339 } from '../../src/domain/calendarDate';
import type { FamilyHubGateway } from '../../src/data/gateway';
import { createHttpGateway } from '../../src/data/httpGateway';
import { hashPassword } from '../auth/password';
import { cookieNames, createSession } from '../auth/sessions';
import type { Scanner } from '../adapters/scanner';
import type { ServerConfig } from '../config';
import { Db } from '../db/db';
import { buildApp } from '../http/app';
import type { AppDeps } from '../http/context';
import { SEED_PASSWORD, seedHousehold } from './seed';

const ORIGIN = 'https://family.example.test';
export const testConfig: ServerConfig = { production: false, origin: ORIGIN, databasePath: ':memory:', secret: 'test-secret-test-secret-test-secret-00', secureCookies: true, sessionDays: 30, recentAuthMs: 300_000, smtp: null, mediaPath: '', clamd: null };

let cachedHash: Promise<string> | undefined;
const passwordHash = () => (cachedHash ??= hashPassword(SEED_PASSWORD));

export interface World {
  gateway: FamilyHubGateway;
  deps: AppDeps;
  mail: Array<{ to: string; subject: string; text: string }>;
  ready: Promise<{ url: string; cookies: Map<string, string> }>;
  close(): Promise<void>;
}

/** 実際の Fastify を起動し、Cookie を保持する fetch で httpGateway をつなぐ。時計は1回の変更の操作ごとに1分進む。 */
export function createWorld(actorMembershipId = 'member-aoi', inspect?: (body: unknown, request: { method: string; url: string; status: number }) => void, scanner: Scanner = { scan: async () => 'clean', ready: async () => true }): World {
  let tick = 0; let sequence = 0;
  const mail: World['mail'] = [];
  const db = new Db(':memory:');
  const deps: AppDeps = {
    db, config: { ...testConfig, mediaPath: mkdtempSync(join(tmpdir(), 'family-hub-media-')) }, scanner, jobs: new Set(),
    clock: { now: () => toJstRfc3339(new Date(Date.parse('2026-09-30T07:45:00+09:00') + tick * 60_000)) },
    mailer: { available: true, send: async (message) => { mail.push(message); } },
    ids: { next: (prefix) => `${prefix}-mock-${++sequence}`, inviteToken: () => `FAMILY-2026-${String(sequence).padStart(4, '0')}-ONE-TIME` },
  };
  const cookies = new Map<string, string>();
  const boot = (async () => {
    seedHousehold(db, await passwordHash(), '2026-09-01T00:00:00+09:00');
    const member = db.get<{ user_id: string }>('SELECT user_id FROM household_members WHERE membership_id = ?', actorMembershipId);
    if (!member) throw new Error('unknown member');
    cookies.set(cookieNames(testConfig).session, createSession(db, testConfig, member.user_id, '2026-09-30T07:44:00+09:00', '試験', `session-${actorMembershipId}`));
    // 本人確認の期限を気にせず規則を試すため、確認の時刻を先へ置く。
    db.run("UPDATE sessions SET reauthenticated_at = '2027-01-01T00:00:00+09:00'");
    const app = await buildApp(deps);
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    return { app, url };
  })();
  const cookieJar: typeof fetch = async (input, init) => {
    const { url } = await boot;
    const target = new URL(String(input instanceof Request ? input.url : input));
    const response = await fetch(`${url}${target.pathname}${target.search}`, {
      ...init,
      headers: { ...init?.headers as Record<string, string>, Origin: ORIGIN, Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
    });
    if (target.pathname !== '/v1/auth/csrf' && (init?.method ?? 'GET') !== 'GET') tick += 1;
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    if (inspect && response.status !== 204 && (response.headers.get('content-type') ?? '').includes('json')) inspect(await response.clone().json().catch(() => undefined), { method: init?.method ?? 'GET', url: `${target.pathname}${target.search}`, status: response.status });
    return response;
  };
  let token: string | undefined;
  const csrf = async (refresh?: boolean) => {
    if (!token || refresh) token = (await (await cookieJar(new URL('/v1/auth/csrf', ORIGIN))).json() as { token: string }).token;
    return token;
  };
  const gateway = createHttpGateway(ORIGIN, csrf, () => undefined, cookieJar);
  return { gateway, deps, mail, ready: boot.then(({ url }) => ({ url, cookies })), close: async () => { const { app } = await boot; await app.close(); db.close(); } };
}
