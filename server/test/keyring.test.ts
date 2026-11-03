import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverMessages } from '../../src/content/serverMessages';
import { Keyring, LEGACY_KID, keyringSourceFrom, syncKeyring } from '../auth/keyring';
import { csrfTokenFor, csrfTokenMatches } from '../auth/sessions';
import { hotp, openTotpSecret, stepAt } from '../auth/totp';
import { Db } from '../db/db';
import { runOperatorCommand } from '../operator';
import { createWorld, testConfig } from '../testing/world';
import type { World } from '../testing/world';

const ORIGIN = 'https://family.example.test';
const OLD = 'old-secret-old-secret-old-secret-0000';
const NEW = 'new-secret-new-secret-new-secret-1111';
const OTHER = 'other-secret-other-secret-other-2222';
const ring = (keys: Record<string, string>, activeKid: string) => new Keyring({ keys: Object.entries(keys).map(([kid, secret]) => ({ kid, secret })), activeKid });

/** HEAD 03f7897 の encryptSecret（AES-256-GCM、AAD なし、`iv.tag.本文`）で作った固定の値。秘密は '12345678901234567890'、鍵は testConfig の秘密。 */
const LEGACY_TOTP = '4dBwPIjrOcvQ1bUp.vfx50ANLkurqTy3ByfOaJw.P39aIDAUBtGNTObGq5SQ-jOvVEA';
const RFC_SECRET = Buffer.from('12345678901234567890');

const worlds: World[] = [];
const open = (keys: Keyring, databasePath?: string) => { const world = createWorld('member-aoi', undefined, undefined, undefined, { keys, databasePath }); worlds.push(world); return world; };
afterEach(async () => { await Promise.all(worlds.splice(0).map((world) => world.close())); vi.restoreAllMocks(); });
const tempDatabase = () => join(mkdtempSync(join(tmpdir(), 'family-hub-keys-')), 'family-hub.sqlite');

/** サインインの前の画面と同じ手順（CSRF → パスワード → 確認コード）を、Cookie を持たない新しい端末として行う。 */
async function signIn(world: World, password: string, code?: () => string) {
  const { url } = await world.ready;
  const pre = await fetch(`${url}/v1/auth/csrf`);
  const cookie = pre.headers.getSetCookie()[0].split(';')[0];
  const { token } = await pre.json() as { token: string };
  const headers = { Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': token };
  const first = await fetch(`${url}/v1/auth/password`, { method: 'POST', headers, body: JSON.stringify({ email: 'aoi@example.test', password }) });
  const body = await first.json() as { totpChallengeId?: string };
  if (!code || !body.totpChallengeId) return { status: first.status, body };
  const second = await fetch(`${url}/v1/auth/totp/verify`, { method: 'POST', headers, body: JSON.stringify({ challengeId: body.totpChallengeId, code: code() }) });
  return { status: second.status, body: await second.json() as Record<string, unknown> };
}
const codeAt = (world: World, secret: Buffer) => () => hotp(secret, stepAt(Date.parse(world.deps.clock.now())));

/** 今の鍵束で確認コードを登録し、平文の秘密と回復コードを返す。 */
async function enrol(world: World) {
  expect((await world.gateway.auth.beginTotpEnrollment()).ok).toBe(true);
  const stored = world.deps.db.get<{ totp_secret: string }>("SELECT totp_secret FROM users WHERE id = 'user-aoi'")?.totp_secret ?? '';
  const secret = openTotpSecret(world.deps.config.keys, 'user-aoi', stored);
  if (!secret) throw new Error('enrolment failed');
  const confirmed = await world.gateway.auth.confirmTotpEnrollment(codeAt(world, secret)());
  if (!confirmed.ok) throw new Error('confirmation failed');
  return { secret, recoveryCodes: confirmed.value.recoveryCodes, stored };
}

function operator(databasePath: string, keys: Keyring, argv: string[]) {
  const db = new Db(databasePath);
  const out: string[] = []; const err: string[] = [];
  try {
    const code = runOperatorCommand(argv, { db, keys, now: '2026-10-01T09:00:00+09:00', out: (line) => out.push(line), err: (line) => err.push(line) });
    return { code, out, err, audit: db.all<{ action: string; target: string | null; household_id: string | null }>("SELECT action, target, household_id FROM audit_events WHERE actor_user_id = 'operator' ORDER BY rowid") };
  } finally { db.close(); }
}

describe('configuration (A7-1)', () => {
  it('keeps FAMILY_HUB_SECRET working as the active legacy key', () => {
    expect(keyringSourceFrom({ FAMILY_HUB_SECRET: OLD }, true)).toEqual({ keys: [{ kid: LEGACY_KID, secret: OLD }], activeKid: LEGACY_KID });
    expect(keyringSourceFrom({}, false).activeKid).toBe(LEGACY_KID);
    expect(() => keyringSourceFrom({}, true)).toThrow('FAMILY_HUB_SECRET');
  });

  it('reads FAMILY_HUB_KEYS with the active kid and keeps FAMILY_HUB_SECRET readable as legacy', () => {
    expect(keyringSourceFrom({ FAMILY_HUB_KEYS: `k2025=${OLD}, k2026=${NEW}`, FAMILY_HUB_ACTIVE_KID: 'k2026' }, true)).toEqual({ keys: [{ kid: 'k2025', secret: OLD }, { kid: 'k2026', secret: NEW }], activeKid: 'k2026' });
    expect(keyringSourceFrom({ FAMILY_HUB_KEYS: `k2026=${NEW}`, FAMILY_HUB_SECRET: OLD }, true)).toEqual({ keys: [{ kid: 'k2026', secret: NEW }, { kid: LEGACY_KID, secret: OLD }], activeKid: 'k2026' });
  });

  it.each([
    [{ FAMILY_HUB_KEYS: 'k1=short' }, 'at least 32'],
    [{ FAMILY_HUB_KEYS: `bad.kid=${NEW}` }, 'kid=secret'],
    [{ FAMILY_HUB_KEYS: `k1=${NEW},k1=${OLD}` }, 'twice'],
    [{ FAMILY_HUB_KEYS: `k1=${NEW},k2=${OLD}` }, 'FAMILY_HUB_ACTIVE_KID is required'],
    [{ FAMILY_HUB_KEYS: `k1=${NEW}`, FAMILY_HUB_ACTIVE_KID: 'k9' }, 'not in FAMILY_HUB_KEYS'],
    [{ FAMILY_HUB_KEYS: `legacy=${NEW}`, FAMILY_HUB_SECRET: OLD }, 'differs'],
  ])('refuses %o', (env, message) => {
    expect(() => keyringSourceFrom(env, true)).toThrow(message);
  });
});

describe('sealed secrets (A7-2)', () => {
  it('reads the previous format as the legacy key, from a fixed value', () => {
    expect(openTotpSecret(testConfig.keys, 'user-aoi', LEGACY_TOTP)).toEqual(RFC_SECRET);
    expect(Keyring.kidOf(LEGACY_TOTP)).toBe(LEGACY_KID);
  });

  it('writes v2.<kid>.<iv>.<tag>.<ct> bound to the person and the purpose', () => {
    const keys = ring({ k1: OLD }, 'k1');
    const sealed = keys.seal('totp-secret', 'user-aoi', RFC_SECRET);
    expect(sealed).toMatch(/^v2\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(keys.open('totp-secret', 'user-aoi', sealed)).toEqual(RFC_SECRET);
    expect(keys.open('totp-secret', 'user-ren', sealed)).toBeNull();
  });

  it('answers null, never throws, for a missing kid, another secret or a broken value', () => {
    const sealed = ring({ k1: OLD }, 'k1').seal('totp-secret', 'user-aoi', RFC_SECRET);
    expect(ring({ k2: NEW }, 'k2').open('totp-secret', 'user-aoi', sealed)).toBeNull();
    expect(ring({ k1: OTHER }, 'k1').open('totp-secret', 'user-aoi', sealed)).toBeNull();
    for (const broken of ['', 'v2', 'v2.k1', 'v2.k1.a.b.c', 'a.b', 'a.b.c', `${sealed}x`, sealed.replace('v2.k1', 'v2.k1.x')]) expect(ring({ k1: OLD }, 'k1').open('totp-secret', 'user-aoi', broken)).toBeNull();
  });
});

describe('signatures across a rotation (A7-3)', () => {
  it('signs with the active key and accepts every key that is not retired', () => {
    const before = { ...testConfig, keys: ring({ k1: OLD }, 'k1') };
    const after = { ...testConfig, keys: ring({ k1: OLD, k2: NEW }, 'k2') };
    const token = csrfTokenFor(before, 'session-1');
    expect(csrfTokenMatches(after, 'session-1', token)).toBe(true);
    expect(csrfTokenFor(after, 'session-1')).not.toBe(token);
    expect(csrfTokenMatches(after, 'session-2', token)).toBe(false);
    const link = before.keys.sign('attachment', 'file-1:1700000000000:attachment');
    expect(after.keys.verify('attachment', 'file-1:1700000000000:attachment', link)).toBe(true);
    expect(after.keys.verify('csrf', 'file-1:1700000000000:attachment', link)).toBe(false);
    after.keys.setRecordedState(['k1'], []);
    expect(csrfTokenMatches(after, 'session-1', token)).toBe(false);
    expect(after.keys.verify('attachment', 'file-1:1700000000000:attachment', link)).toBe(false);
    expect(csrfTokenMatches({ ...testConfig, keys: ring({ k3: OTHER }, 'k3') }, 'session-1', token)).toBe(false);
  });

  it('finds a reset link issued before the rotation, with every key', async () => {
    const path = tempDatabase();
    const first = open(ring({ [LEGACY_KID]: OLD }, LEGACY_KID), path);
    await first.ready;
    expect(await first.gateway.auth.requestPasswordReset('aoi@example.test')).toMatchObject({ ok: true });
    const token = /#token=([A-Za-z0-9_-]+)/.exec(first.mail[0].text)?.[1] ?? '';
    const code = /\n(\d{6})\n/.exec(first.mail[0].text)?.[1] ?? '';
    await first.close(); worlds.splice(worlds.indexOf(first), 1);
    const second = open(ring({ [LEGACY_KID]: OLD, k2026: NEW }, 'k2026'), path);
    expect(await second.gateway.auth.confirmPasswordReset({ token, newPassword: 'a-new-password-after-rotation' })).toEqual({ ok: true, value: undefined });
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe('rotating and removing a key (A7-4)', () => {
  it('re-seals every secret under the active key, then still verifies the code without the old key', async () => {
    const path = tempDatabase();
    const first = open(ring({ [LEGACY_KID]: OLD }, LEGACY_KID), path);
    const { secret } = await enrol(first);
    await first.close(); worlds.splice(worlds.indexOf(first), 1);

    const both = ring({ [LEGACY_KID]: OLD, k2026: NEW }, 'k2026');
    expect(operator(path, both, ['keys', 'retire', LEGACY_KID])).toMatchObject({ code: 1, err: [expect.stringContaining('still seals 1')] });
    expect(operator(path, both, ['keys', 'status']).out).toEqual(['active k2026', 'legacy available totp=1', 'k2026 active totp=0']);
    expect(operator(path, both, ['keys', 'rotate'])).toMatchObject({ code: 0, out: ['rotated 1 to k2026'], err: [] });
    // 何度実行してもよい。
    expect(operator(path, both, ['keys', 'rotate'])).toMatchObject({ code: 0, out: ['rotated 0 to k2026'] });
    expect(operator(path, both, ['keys', 'status']).out).toEqual(['active k2026', 'legacy available totp=0', 'k2026 active totp=1']);
    expect(operator(path, both, ['keys', 'retire', 'k2026'])).toMatchObject({ code: 1, err: [expect.stringContaining('active key')] });
    const retired = operator(path, both, ['keys', 'retire', LEGACY_KID]);
    expect(retired).toMatchObject({ code: 0 });
    expect(retired.audit.map((row) => [row.action, row.target])).toEqual([['operator.keysRotate', 'k2026'], ['operator.keysRotate', 'k2026'], ['operator.keysRetire', LEGACY_KID]]);

    const db = new Db(path); db.run("UPDATE users SET totp_last_step = NULL WHERE id = 'user-aoi'"); db.close();
    const second = open(ring({ k2026: NEW }, 'k2026'), path);
    expect(await signIn(second, 'current-password-long-enough', codeAt(second, secret))).toMatchObject({ status: 200, body: { userId: 'user-aoi' } });
    expect(await second.gateway.auth.getAccount()).toMatchObject({ ok: true, value: { totpEnabled: true, totpUnavailable: false } });
  });

  it('refuses to start when the active key has been retired', () => {
    const db = new Db(':memory:');
    const keys = ring({ k1: OLD, k2: NEW }, 'k2');
    syncKeyring(db, keys, '2026-10-01T09:00:00+09:00');
    db.run("UPDATE key_fingerprints SET retired_at = '2026-10-01T09:00:00+09:00' WHERE kid = 'k2'");
    expect(() => syncKeyring(db, keys, '2026-10-01T09:00:00+09:00')).toThrow('retired');
    db.close();
  });
});

describe('a lost key (A7-5, A7-6)', () => {
  it('starts, marks the code unavailable, lets a recovery code sign in, and allows setting up again', async () => {
    const path = tempDatabase();
    const first = open(ring({ [LEGACY_KID]: OLD }, LEGACY_KID), path);
    const { recoveryCodes } = await enrol(first);
    await first.close(); worlds.splice(worlds.indexOf(first), 1);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const second = open(ring({ k2026: NEW }, 'k2026'), path);
    await second.ready;
    expect(warn.mock.calls.flat().join('\n')).toContain('1 two-step secret(s) use key legacy, which is missing or retired');
    expect(await second.gateway.auth.getAccount()).toMatchObject({ ok: true, value: { totpEnabled: true, totpUnavailable: true } });
    expect(await signIn(second, 'current-password-long-enough', () => '123456')).toEqual({ status: 401, body: expect.objectContaining({ code: 'UNAUTHENTICATED', message: serverMessages.totpUnavailable }) });
    expect(await signIn(second, 'current-password-long-enough', () => recoveryCodes[0])).toMatchObject({ status: 200, body: { userId: 'user-aoi' } });
    expect(operator(path, ring({ k2026: NEW }, 'k2026'), ['keys', 'status']).out).toContain('legacy missing totp=1');

    expect(await second.gateway.auth.disableTotp()).toEqual({ ok: true, value: undefined });
    const again = await enrol(second);
    expect(again.stored).toMatch(/^v2\.k2026\./);
    expect(await second.gateway.auth.getAccount()).toMatchObject({ ok: true, value: { totpEnabled: true, totpUnavailable: false } });
  });

  it('never answers 500 when the secret of a kid has changed', async () => {
    const path = tempDatabase();
    const first = open(ring({ [LEGACY_KID]: OLD }, LEGACY_KID), path);
    await enrol(first);
    await first.close(); worlds.splice(worlds.indexOf(first), 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const second = open(ring({ [LEGACY_KID]: OTHER }, LEGACY_KID), path);
    await second.ready;
    expect(warn.mock.calls.flat().join('\n')).toContain('the secret of key legacy differs');
    const answer = await signIn(second, 'current-password-long-enough', () => '123456');
    expect(answer.status).toBe(401);
    expect(await second.gateway.auth.getAccount()).toMatchObject({ ok: true, value: { totpUnavailable: true } });
  });

  it('reads a secret stored in the previous format and signs in with its code', async () => {
    const world = open(testConfig.keys);
    await world.ready;
    world.deps.db.run("UPDATE users SET totp_secret = ?, totp_enabled_at = '2026-09-01T00:00:00+09:00' WHERE id = 'user-aoi'", LEGACY_TOTP);
    expect(await signIn(world, 'current-password-long-enough', codeAt(world, RFC_SECRET))).toMatchObject({ status: 200 });
  });

  it('lets the operator remove the code, with an audit record', async () => {
    const path = tempDatabase();
    const first = open(ring({ [LEGACY_KID]: OLD }, LEGACY_KID), path);
    await enrol(first);
    await first.close(); worlds.splice(worlds.indexOf(first), 1);
    const keys = ring({ k2026: NEW }, 'k2026');
    expect(operator(path, keys, ['totp', 'reset', '--user', 'user-nobody'])).toMatchObject({ code: 1, err: ['user not found'] });
    const reset = operator(path, keys, ['totp', 'reset', '--user', 'user-aoi']);
    expect(reset).toMatchObject({ code: 0 });
    expect(reset.audit.at(-1)).toEqual({ action: 'operator.totpReset', target: 'user-aoi', household_id: 'house-mori' });
    const db = new Db(path);
    expect(db.get("SELECT totp_secret, totp_enabled_at FROM users WHERE id = 'user-aoi'")).toEqual({ totp_secret: null, totp_enabled_at: null });
    expect(db.get<{ count: number }>("SELECT count(*) AS count FROM recovery_codes WHERE user_id = 'user-aoi'")?.count).toBe(0);
    db.close();
    expect(operator(path, keys, ['keys', 'retire', LEGACY_KID])).toMatchObject({ code: 0 });
  });
});

describe('operator command exit codes', () => {
  it('returns 1 for usage errors and unknown keys', () => {
    const path = tempDatabase();
    const keys = ring({ k1: OLD }, 'k1');
    expect(operator(path, keys, [])).toMatchObject({ code: 1, err: [expect.stringContaining('usage:')] });
    expect(operator(path, keys, ['keys'])).toMatchObject({ code: 1 });
    expect(operator(path, keys, ['keys', 'retire'])).toMatchObject({ code: 1 });
    expect(operator(path, keys, ['keys', 'retire', 'nope'])).toMatchObject({ code: 1, err: ['unknown key nope'] });
    expect(operator(path, keys, ['totp', 'reset', 'user-aoi'])).toMatchObject({ code: 1 });
    expect(operator(path, keys, ['keys', 'status'])).toMatchObject({ code: 0, out: ['active k1', 'k1 active totp=0'] });
  });

  it('sets the process exit code from the command line entry', async () => {
    const path = tempDatabase();
    const run = (args: string[]) => promisify(execFile)(resolve(import.meta.dirname, '../../node_modules/.bin/tsx'), [resolve(import.meta.dirname, '../cli.ts'), ...args], { env: { ...process.env, FAMILY_HUB_DATABASE: path, FAMILY_HUB_KEYS: `k1=${OLD}`, FAMILY_HUB_SECRET: '' } }).then(() => 0, (error: { code?: number }) => error.code ?? -1);
    expect(await run(['keys', 'status'])).toBe(0);
    expect(await run(['keys', 'retire', 'k1'])).toBe(1);
    expect(await run(['keys', 'retire', 'unknown'])).toBe(1);
  }, 30_000);
});
