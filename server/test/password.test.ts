import { hashRaw, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPassword, hashPassword, verifyPassword } from '../auth/password';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

/**
 * 以前の形式（Node の crypto.argon2 で作った `argon2id$m=…,t=…,p=…$<salt>$<hash>`、base64url）の固定の試験値。
 * 2026-11-03 に一度だけ作って貼り付けた。試験の中で crypto.argon2 は呼ばない（A10-3）。
 * salt は 'legacyvector-sal'（16バイト）、パスワードは LEGACY_PASSWORD。
 */
const LEGACY_PASSWORD = 'correct horse battery staple legacy';
const LEGACY_CURRENT = 'argon2id$m=46080,t=2,p=1$bGVnYWN5dmVjdG9yLXNhbA$rAOr7eCX2OdlhkJniAkhhhGykZ7uzuGEJHyXz6mhWtI';
const LEGACY_LIGHTER = 'argon2id$m=19456,t=2,p=1$bGVnYWN5dmVjdG9yLXNhbA$rWVBpN6hpiV-I83kD5peNEbA8yEyl0BGYlim5SRWhEo';
const PHC_CURRENT = /^\$argon2id\$v=19\$m=46080,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

const ORIGIN = 'https://family.example.test';
const worlds: World[] = [];
const open = () => { const world = createWorld(); worlds.push(world); return world; };
afterEach(async () => { await Promise.all(worlds.splice(0).map((world) => world.close())); });

async function signIn(world: World, email: string, password: string) {
  const { url } = await world.ready;
  const pre = await fetch(`${url}/v1/auth/csrf`);
  const cookie = pre.headers.getSetCookie()[0].split(';')[0];
  const { token } = await pre.json() as { token: string };
  return fetch(`${url}/v1/auth/password`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ email, password }) });
}
const storedHash = (world: World, id: string) => world.deps.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', id)?.password_hash;

describe('password hashing with @node-rs/argon2 (A10-1)', () => {
  it('stores the PHC string with a 16-byte salt, m=46080, t=2, p=1 and a 32-byte hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-long-enough'), hashPassword('same-password-long-enough')]);
    expect(a).toMatch(PHC_CURRENT);
    expect(a).not.toBe(b);
    expect(a.split('$').slice(-2).join('')).not.toContain('=');
    // 別の実装（ライブラリの PHC の検証）でも読める標準の形式であること。
    expect(await verify(a, 'same-password-long-enough')).toBe(true);
    expect(await verifyPassword('same-password-long-enough', a)).toBe(true);
    expect(await verifyPassword('another-password-long-enough', a)).toBe(false);
    expect(await checkPassword('same-password-long-enough', a)).toEqual({ matched: true, needsRehash: false });
  });

  it('reads the previous format from fixed values and asks to store it again (A10-2, A10-3)', async () => {
    expect(await checkPassword(LEGACY_PASSWORD, LEGACY_CURRENT)).toEqual({ matched: true, needsRehash: true });
    expect(await checkPassword(LEGACY_PASSWORD, LEGACY_LIGHTER)).toEqual({ matched: true, needsRehash: true });
    expect(await checkPassword('correct horse battery staple legacx', LEGACY_CURRENT)).toEqual({ matched: false, needsRehash: false });
    // base64url の '-' を標準の base64 として読み違えないこと。
    expect(await checkPassword(LEGACY_PASSWORD, LEGACY_LIGHTER.replace('-', '+'))).toEqual({ matched: false, needsRehash: false });
  });

  it('asks to store again when the parameters differ from the current ones', async () => {
    const salt = Buffer.from('0123456789abcdef');
    const lighter = await hashRaw('lighter-password-long-enough', { algorithm: 2 as Algorithm, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32, salt });
    const stored = `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString('base64').replace(/=+$/, '')}$${lighter.toString('base64').replace(/=+$/, '')}`;
    expect(await checkPassword('lighter-password-long-enough', stored)).toEqual({ matched: true, needsRehash: true });
  });

  it('never matches an unknown user, an unreadable value or out-of-range parameters, and still does the work', async () => {
    for (const stored of [null, undefined, '', 'plain', '$argon2id$v=19$m=99999999,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '$argon2i$v=19$m=46080,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']) {
      expect(await checkPassword('whatever-password-long', stored)).toEqual({ matched: false, needsRehash: false });
    }
    const time = async (stored: string | null) => { const started = performance.now(); await verifyPassword('timing-password-long-enough', stored); return performance.now() - started; };
    const known = await hashPassword('timing-password-long-enough');
    const median = (values: number[]) => values.sort((x, y) => x - y)[1];
    const knownMs = median([await time(known), await time(known), await time(known)]);
    const unknownMs = median([await time(null), await time(null), await time(null)]);
    // 登録のない人にも同じ重さの計算をする（応答の時間で存在を知らせない）。
    expect(unknownMs).toBeGreaterThan(knownMs * 0.5);
  });
});

describe('upgrading stored hashes at sign-in (A10-2)', () => {
  it('signs in with the previous format and stores the PHC string, then signs in again with it', async () => {
    const world = open();
    await world.ready;
    world.deps.db.run("UPDATE users SET password_hash = ? WHERE id = 'user-ren'", LEGACY_LIGHTER);
    expect((await signIn(world, 'ren@example.test', 'wrong-password-long-enough')).status).toBe(401);
    expect(storedHash(world, 'user-ren')).toBe(LEGACY_LIGHTER);
    expect((await signIn(world, 'ren@example.test', LEGACY_PASSWORD)).status).toBe(200);
    const upgraded = storedHash(world, 'user-ren');
    expect(upgraded).toMatch(PHC_CURRENT);
    expect((await signIn(world, 'ren@example.test', LEGACY_PASSWORD)).status).toBe(200);
    expect(storedHash(world, 'user-ren')).toBe(upgraded);
  });

  it('leaves a current hash alone', async () => {
    const world = open();
    await world.ready;
    const before = storedHash(world, 'user-aoi');
    expect(before).toMatch(PHC_CURRENT);
    expect((await signIn(world, 'aoi@example.test', 'current-password-long-enough')).status).toBe(200);
    expect(storedHash(world, 'user-aoi')).toBe(before);
  });
});
