import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toJstRfc3339 } from '../../src/domain/calendarDate';
import type { FamilyHubGateway } from '../../src/data/gateway';
import { createHttpGateway } from '../../src/data/httpGateway';
import { Keyring, LEGACY_KID } from '../auth/keyring';
import { hashPassword } from '../auth/password';
import { cookieNames, createSession } from '../auth/sessions';
import { createLlmClient } from '../adapters/llm';
import type { LlmClient } from '../adapters/llm';
import type { Scanner } from '../adapters/scanner';
import { createPageFetcher } from '../adapters/urlFetcher';
import type { PageFetcher } from '../adapters/urlFetcher';
import type { ServerConfig } from '../config';
import { Db } from '../db/db';
import { AuditLog } from '../audit/log';
import { AuditStore } from '../audit/store';
import { buildApp } from '../http/app';
import type { AppDeps } from '../http/context';
import { startFakeLlm } from './fakeLlm';
import { SEED_PASSWORD, seedHousehold } from './seed';

const ORIGIN = 'https://family.example.test';
export const testConfig: ServerConfig = { production: false, origin: ORIGIN, databasePath: ':memory:', auditDatabasePath: ':memory:', auditRetentionMonths: 24, keys: new Keyring({ keys: [{ kid: LEGACY_KID, secret: 'test-secret-test-secret-test-secret-00' }], activeKid: LEGACY_KID }), secureCookies: true, sessionDays: 30, recentAuthMs: 300_000, smtp: null, mediaPath: '', clamd: null, llm: null, backup: null };

let cachedHash: Promise<string> | undefined;
const passwordHash = () => (cachedHash ??= hashPassword(SEED_PASSWORD));

let sharedLlm: Promise<LlmClient> | undefined;
/** 既定の読み取りの代役。試験全体で1つを使う。 */
const defaultLlm: LlmClient = {
  available: true,
  complete: async (system, user) => {
    sharedLlm ??= startFakeLlm().then(({ url }) => createLlmClient({ url, model: 'test-double', timeoutMs: 5000 }));
    return (await sharedLlm).complete(system, user);
  },
};

const realCheck = createPageFetcher();
/** 既定のページの代役。接続先の確認は本物を使う。通信の試験は urlFetcher.test.ts で行う。 */
const defaultPages: PageFetcher = { check: realCheck.check, read: (url) => Promise.resolve({ url, text: '区民まつり 10月27日 10:00から 中央公園' }) };

export interface World {
  gateway: FamilyHubGateway;
  deps: AppDeps;
  mail: Array<{ to: string; subject: string; text: string }>;
  ready: Promise<{ url: string; cookies: Map<string, string> }>;
  close(): Promise<void>;
}

/** 実際の Fastify を起動し、Cookie を保持する fetch で httpGateway をつなぐ。時計は1回の変更の操作ごとに1分進む。 */
/** 鍵の試験のための差し替え。databasePath を渡すと、そのファイルを使い（起動し直しの試験）、見本の家族は空のときだけ入れる。 */
export interface WorldOptions { keys?: ServerConfig['keys']; databasePath?: string; auditDatabasePath?: string; mediaPath?: string }

export function createWorld(actorMembershipId = 'member-aoi', inspect?: (body: unknown, request: { method: string; url: string; status: number }) => void, scanner: Scanner = { scan: async () => 'clean', ready: async () => true }, reading: { llm?: LlmClient; pages?: PageFetcher } = {}, options: WorldOptions = {}): World {
  let tick = 0; let sequence = 0;
  const mail: World['mail'] = [];
  const db = new Db(options.databasePath ?? ':memory:');
  const auditStore = new AuditStore(options.auditDatabasePath ?? (options.databasePath ? `${options.databasePath}.audit.db` : ':memory:'));
  const deps: AppDeps = {
    db, audit: new AuditLog(db, auditStore, { info: () => undefined, error: () => undefined }), config: { ...testConfig, keys: options.keys ?? testConfig.keys, mediaPath: options.mediaPath ?? mkdtempSync(join(tmpdir(), 'family-hub-media-')) }, scanner, jobs: new Set(), runningReads: new Set(), llm: reading.llm ?? defaultLlm, pages: reading.pages ?? defaultPages,
    clock: { now: () => toJstRfc3339(new Date(Date.parse('2026-09-30T07:45:00+09:00') + tick * 60_000)) },
    weather: { current: () => ({ location: '東京', condition: 'rain', temperatureC: 20, precipitationPercent: 70, alert: '見本の天気' }), refresh: async () => undefined },
    mailer: { available: true, send: async (message) => { mail.push(message); } },
    ids: { next: (prefix) => `${prefix}-mock-${++sequence}`, inviteToken: () => `FAMILY-2026-${String(sequence).padStart(4, '0')}-ONE-TIME` },
  };
  const cookies = new Map<string, string>();
  const boot = (async () => {
    if (!db.get('SELECT id FROM users LIMIT 1')) seedHousehold(db, await passwordHash(), '2026-09-01T00:00:00+09:00');
    const member = db.get<{ user_id: string }>('SELECT user_id FROM household_members WHERE membership_id = ?', actorMembershipId);
    if (!member) throw new Error('unknown member');
    cookies.set(cookieNames(testConfig).session, createSession(db, testConfig, member.user_id, '2026-09-30T07:44:00+09:00', '試験', options.databasePath ? `session-${actorMembershipId}-${randomUUID()}` : `session-${actorMembershipId}`));
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
  return { gateway, deps, mail, ready: boot.then(({ url }) => ({ url, cookies })), close: async () => { const { app } = await boot; await Promise.all([...deps.jobs]); app.server.closeAllConnections(); await app.close(); auditStore.close(); db.close(); } };
}
