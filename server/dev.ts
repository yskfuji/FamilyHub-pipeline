import { randomBytes, randomUUID } from 'node:crypto';
import { toJstRfc3339 } from '../src/domain/calendarDate';
import { hashPassword } from './auth/password';
import { loadConfig } from './config';
import { Db } from './db/db';
import { createMailer } from './adapters/mail';
import { buildApp } from './http/app';
import { SEED_PASSWORD, seedHousehold } from './testing/seed';

/** 開発用の起動。見本の家族を入れる。本番の組み立てには含めない。 */
const config = loadConfig({ ...process.env, FAMILY_HUB_DATABASE: process.env.FAMILY_HUB_DATABASE ?? 'data/dev.sqlite' });
const db = new Db(config.databasePath);
const now = () => toJstRfc3339(new Date());
if (!db.get('SELECT id FROM users LIMIT 1')) seedHousehold(db, await hashPassword(SEED_PASSWORD), now());
const app = await buildApp({ db, config, mailer: createMailer(config), clock: { now }, ids: { next: (prefix) => `${prefix}-${randomUUID()}`, inviteToken: () => randomBytes(18).toString('base64url') } });
const address = await app.listen({ port: Number(process.env.PORT ?? 8799), host: '127.0.0.1' });
console.log(`API ${address} (sign in as aoi@example.test / ${SEED_PASSWORD})`);
