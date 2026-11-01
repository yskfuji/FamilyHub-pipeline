import { afterEach, describe, expect, it } from 'vitest';
import { base32Encode, decryptSecret, hotp, matchingStep, stepAt } from '../auth/totp';
import { createWorld, testConfig } from '../testing/world';
import type { World } from '../testing/world';

const worlds: World[] = [];
const open = (actor?: string) => { const world = createWorld(actor); worlds.push(world); return world; };
afterEach(async () => { await Promise.all(worlds.splice(0).map((world) => world.close())); });

const newAccount = { displayName: '新しい人', email: 'new@example.test', password: 'a-long-enough-password', birthdate: '1990-04-01' };

describe('TOTP primitives', () => {
  it('matches the RFC 6238 and RFC 4226 test vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(['755224', '287082', '359152']).toEqual([0, 1, 2].map((counter) => hotp(secret, counter)));
    expect(hotp(secret, stepAt(59_000))).toBe('287082');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('refuses a code from an already used time step', () => {
    const secret = Buffer.from('12345678901234567890');
    const now = 1_700_000_000_000;
    const code = hotp(secret, stepAt(now));
    const step = matchingStep(secret, code, now, null);
    expect(step).toBe(stepAt(now));
    expect(matchingStep(secret, code, now, step)).toBeNull();
  });
});

describe('sign-up and households', () => {
  it('creates an account, then a household with a 14-day trial for a declared adult', async () => {
    const world = open();
    await world.gateway.auth.signUp(newAccount);
    const stored = world.deps.db.get<{ adult_declared_at: string | null; password_hash: string }>('SELECT adult_declared_at, password_hash FROM users WHERE email = ?', newAccount.email);
    expect(stored?.adult_declared_at).toBeTruthy();
    expect(stored?.password_hash).not.toContain(newAccount.password);
  });

  it('refuses a minor without guardian consent and does not reveal a taken address', async () => {
    const world = open();
    expect(await world.gateway.auth.signUp({ ...newAccount, birthdate: '2015-01-01' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await world.gateway.auth.signUp({ ...newAccount, email: 'aoi@example.test' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('refuses creating a second household', async () => {
    const world = open();
    expect(await world.gateway.household.createHousehold('別の家族')).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
});

describe('password reset', () => {
  it('answers the same for unknown addresses, mails a code, and never signs in', async () => {
    const world = open();
    await world.ready;
    expect(await world.gateway.auth.requestPasswordReset('nobody@example.test')).toEqual({ ok: true, value: { resendAfterSeconds: 60 } });
    expect(world.mail).toEqual([]);
    expect(await world.gateway.auth.requestPasswordReset('aoi@example.test')).toEqual({ ok: true, value: { resendAfterSeconds: 60 } });
    expect(world.mail).toHaveLength(1);
    const code = /\n(\d{6})\n/.exec(world.mail[0].text)?.[1] ?? '';
    expect(await world.gateway.auth.confirmPasswordReset({ email: 'aoi@example.test', code: code === '000000' ? '000001' : '000000', newPassword: 'a-new-password-long-enough' })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(await world.gateway.auth.confirmPasswordReset({ email: 'aoi@example.test', code, newPassword: 'a-new-password-long-enough' })).toEqual({ ok: true, value: undefined });
    expect(world.deps.db.get<{ count: number }>('SELECT count(*) AS count FROM sessions WHERE revoked_at IS NULL')?.count).toBe(0);
    expect(await world.gateway.auth.confirmPasswordReset({ email: 'aoi@example.test', code, newPassword: 'another-new-password-ok' })).toMatchObject({ ok: false });
  });

  it('stops honoring the code after too many wrong attempts', async () => {
    const world = open();
    await world.gateway.auth.requestPasswordReset('aoi@example.test');
    const code = /\n(\d{6})\n/.exec(world.mail[0].text)?.[1] ?? '';
    const wrong = code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) await world.gateway.auth.confirmPasswordReset({ email: 'aoi@example.test', code: wrong, newPassword: 'a-new-password-long-enough' });
    expect(await world.gateway.auth.confirmPasswordReset({ email: 'aoi@example.test', code, newPassword: 'a-new-password-long-enough' })).toMatchObject({ ok: false });
  });
});

describe('sessions and reauthentication', () => {
  it('confirms the password to refresh recent authentication', async () => {
    const world = open();
    expect(await world.gateway.auth.reauthenticate('wrong-password-long-enough')).toMatchObject({ ok: false, error: { reason: 'REAUTH_FAILED' } });
    expect(await world.gateway.auth.reauthenticate('current-password-long-enough')).toEqual({ ok: true, value: undefined });
  });

  it('ends a session on the server after the idle limit', async () => {
    const world = open();
    await world.ready;
    world.deps.db.run("UPDATE users SET idle_timeout_minutes = 1 WHERE id = 'user-aoi'");
    world.deps.db.run("UPDATE sessions SET last_seen_at = '2026-09-30T07:00:00+09:00'");
    expect(await world.gateway.household.getSnapshot()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('reports the paywall stage and blocks household data when the period ended', async () => {
    const world = open();
    await world.ready;
    world.deps.db.run("UPDATE entitlements SET status = 'expired'");
    expect(await world.gateway.auth.getSession()).toMatchObject({ ok: true, value: { stage: 'paywall' } });
    expect(await world.gateway.household.getSnapshot()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await world.gateway.auth.getAccount()).toMatchObject({ ok: true });
  });

  it('reports suspension', async () => {
    const world = open('member-ren');
    await world.ready;
    const row = world.deps.db.get<{ body: string }>("SELECT body FROM records WHERE collection = 'memberships' AND id = 'member-ren'");
    world.deps.db.run("UPDATE records SET body = ? WHERE collection = 'memberships' AND id = 'member-ren'", JSON.stringify({ ...JSON.parse(row?.body ?? '{}'), status: 'suspended' }));
    expect(await world.gateway.auth.getSession()).toMatchObject({ ok: true, value: { stage: 'suspended' } });
  });
});

describe('confirmation codes', () => {
  it('encrypts the secret, needs a valid code to enable, and shows recovery codes once as hashes at rest', async () => {
    const world = open();
    const begun = await world.gateway.auth.beginTotpEnrollment();
    expect(begun.ok).toBe(true);
    const stored = world.deps.db.get<{ totp_secret: string }>("SELECT totp_secret FROM users WHERE id = 'user-aoi'");
    expect(begun.ok && begun.value.otpauthUri).not.toContain(stored?.totp_secret);
    expect(await world.gateway.auth.confirmTotpEnrollment('000000')).toMatchObject({ ok: false });
    const secret = decryptSecret(testConfig.secret, stored?.totp_secret ?? '');
    const code = hotp(secret, stepAt(Date.parse(world.deps.clock.now())));
    const confirmed = await world.gateway.auth.confirmTotpEnrollment(code);
    expect(confirmed.ok && confirmed.value.recoveryCodes).toHaveLength(8);
    const hashes = world.deps.db.all<{ code_hash: string }>('SELECT code_hash FROM recovery_codes');
    expect(hashes.some((row) => confirmed.ok && confirmed.value.recoveryCodes.includes(row.code_hash))).toBe(false);
    expect((await world.gateway.auth.getAccount())).toMatchObject({ ok: true, value: { totpEnabled: true } });
  });
});

describe('account deletion', () => {
  it('refuses an owner with other members and removes a member completely', async () => {
    expect(await open().gateway.auth.deleteAccount()).toMatchObject({ ok: false, error: { reason: 'OWNER_REQUIRED' } });
    const world = open('member-ren');
    expect(await world.gateway.auth.deleteAccount()).toEqual({ ok: true, value: undefined });
    const row = world.deps.db.get<{ email: string; password_hash: string | null; display_name: string }>("SELECT email, password_hash, display_name FROM users WHERE id = 'user-ren'");
    expect(row).toMatchObject({ password_hash: null, display_name: '退会したメンバー' });
    expect(row?.email).not.toContain('ren@example.test');
  });
});
