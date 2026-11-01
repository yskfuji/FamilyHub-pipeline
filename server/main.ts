import { randomBytes, randomUUID } from 'node:crypto';
import { toJstRfc3339 } from '../src/domain/calendarDate';
import { loadConfig } from './config';
import { Db } from './db/db';
import { createMailer } from './adapters/mail';
import { createScanner } from './adapters/scanner';
import { createWeatherSource } from './adapters/weather';
import { buildApp } from './http/app';
import { startJobs } from './jobs';

const config = loadConfig();
const db = new Db(config.databasePath);
const jobs = new Set<Promise<void>>();
const deps = {
  db, config, mailer: createMailer(config), scanner: createScanner(config), weather: createWeatherSource(() => Date.now()), jobs,
  clock: { now: () => toJstRfc3339(new Date()) },
  ids: { next: (prefix: string) => `${prefix}-${randomUUID()}`, inviteToken: () => randomBytes(18).toString('base64url') },
};
const app = await buildApp(deps);
startJobs(deps);
const port = Number(process.env.PORT ?? 8799);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => Promise.all([...jobs])).then(() => { db.close(); process.exit(0); }); });
