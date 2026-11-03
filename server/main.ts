import { randomBytes, randomUUID } from 'node:crypto';
import { toJstRfc3339 } from '../src/domain/calendarDate';
import { loadConfig } from './config';
import { Db } from './db/db';
import { AuditLog } from './audit/log';
import { AuditStore } from './audit/store';
import { prepareLlmClient } from './adapters/llm';
import { createMailer } from './adapters/mail';
import { createScanner } from './adapters/scanner';
import { createPageFetcher } from './adapters/urlFetcher';
import { createWeatherSource } from './adapters/weather';
import { holdServerLock } from './backup/lock';
import { buildApp } from './http/app';
import { startJobs } from './jobs';

const config = loadConfig();
// 復元の命令は、このロックを持つ API が動いている間は断る。
holdServerLock(config.databasePath);
const db = new Db(config.databasePath);
const auditStore = new AuditStore(config.auditDatabasePath);
const jobs = new Set<Promise<void>>();
const deps = {
  db, audit: new AuditLog(db, auditStore), config, mailer: createMailer(config), scanner: createScanner(config), weather: createWeatherSource(() => Date.now()), llm: await prepareLlmClient(config.llm), pages: createPageFetcher(), runningReads: new Set<string>(), jobs,
  clock: { now: () => toJstRfc3339(new Date()) },
  ids: { next: (prefix: string) => `${prefix}-${randomUUID()}`, inviteToken: () => randomBytes(18).toString('base64url') },
};
const app = await buildApp(deps);
startJobs(deps);
const port = Number(process.env.PORT ?? 8799);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => Promise.all([...jobs])).then(() => { deps.audit.flush(); auditStore.close(); db.close(); process.exit(0); }); });
