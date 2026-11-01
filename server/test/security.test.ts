import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

const ORIGIN = 'https://family.example.test';
const worlds: World[] = [];
const open = (actor?: string) => { const world = createWorld(actor); worlds.push(world); return world; };
afterEach(async () => { await Promise.all(worlds.splice(0).map((world) => world.close())); });

async function call(world: World, path: string, init: RequestInit = {}) {
  const { url, cookies } = await world.ready;
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  return fetch(`${url}${path}`, { ...init, headers: { Origin: ORIGIN, Cookie: cookie, ...init.headers as Record<string, string> } });
}
const csrf = async (world: World) => (await (await call(world, '/v1/auth/csrf')).json() as { token: string }).token;
const json = (token: string, extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...extra });
const todo = JSON.stringify({ title: '買い物', assigneeMembershipId: 'member-aoi' });

describe('request boundary', () => {
  it('refuses requests without a session', async () => {
    const world = open();
    const { url } = await world.ready;
    const response = await fetch(`${url}/v1/households/current/snapshot`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a mutation without the CSRF token and marks it retryable', async () => {
    const world = open();
    const response = await call(world, '/v1/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: todo });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: 'CSRF', retryable: true });
  });

  it('refuses a token bound to another session', async () => {
    const world = open(); const other = open('member-ren');
    const foreign = await csrf(other);
    expect((await call(world, '/v1/todos', { method: 'POST', headers: json(foreign), body: todo })).status).toBe(403);
  });

  it('refuses cross-site origins and fetch metadata even with a valid token', async () => {
    const world = open(); const token = await csrf(world);
    expect((await call(world, '/v1/todos', { method: 'POST', headers: json(token, { Origin: 'https://evil.example' }), body: todo })).status).toBe(403);
    expect((await call(world, '/v1/todos', { method: 'POST', headers: json(token, { 'Sec-Fetch-Site': 'cross-site' }), body: todo })).status).toBe(403);
  });

  it('replays an identical idempotent request instead of repeating it, and refuses a reused key', async () => {
    const world = open(); const token = await csrf(world);
    const headers = json(token, { 'Idempotency-Key': 'operation-1' });
    const first = await (await call(world, '/v1/todos', { method: 'POST', headers, body: todo })).json() as { id: string };
    const second = await call(world, '/v1/todos', { method: 'POST', headers, body: todo });
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(await second.json()).toMatchObject({ id: first.id });
    const changed = await call(world, '/v1/todos', { method: 'POST', headers, body: JSON.stringify({ title: '別の内容', assigneeMembershipId: 'member-aoi' }) });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ reason: 'IDEMPOTENCY' });
    const snapshot = await world.gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.todos.filter((item) => item.title === '買い物')).toHaveLength(1);
  });

  it('refuses a stale permission revision', async () => {
    const world = open(); const token = await csrf(world);
    const response = await call(world, '/v1/todos', { method: 'POST', headers: json(token, { 'If-Permission-Revision': '99' }), body: todo });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: 'PERMISSION_REVISION' });
  });

  it('requires recent reauthentication for money and permission changes', async () => {
    const world = open(); const token = await csrf(world);
    world.deps.db.run("UPDATE sessions SET reauthenticated_at = '2026-09-30T07:00:00+09:00'");
    const response = await call(world, '/v1/expenses/expense-books/settlements', { method: 'POST', headers: json(token), body: JSON.stringify({ fromMembershipId: 'member-ren', amountJpy: 100 }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'REAUTH_REQUIRED' });
  });

  it('keeps every failed rule from being saved or audited', async () => {
    const world = open();
    await world.gateway.todos.createTodo({ title: '', assigneeMembershipId: 'member-aoi' });
    expect(world.deps.db.get<{ count: number }>('SELECT count(*) AS count FROM audit_events')?.count).toBe(0);
    await world.gateway.todos.createTodo({ title: '記録', assigneeMembershipId: 'member-aoi' });
    expect(world.deps.db.get<{ action: string; target: string | null }>('SELECT action, target FROM audit_events')).toMatchObject({ action: 'createTodo' });
  });
});

describe('secrets at rest', () => {
  it('stores invite codes and session tokens only as hashes', async () => {
    const world = open();
    const invite = await world.gateway.household.createInvite('guest');
    expect(invite.ok && invite.value.token).toBeTruthy();
    const stored = world.deps.db.all<{ body: string }>("SELECT body FROM records WHERE collection = 'invites'");
    expect(stored.some((row) => invite.ok && row.body.includes(invite.value.token ?? 'absent'))).toBe(false);
    const { cookies } = await world.ready;
    const token = [...cookies.values()][0];
    expect(world.deps.db.all<{ token_hash: string }>('SELECT token_hash FROM sessions').some((row) => row.token_hash === token)).toBe(false);
  });

  it('hashes passwords with a random salt', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-long-enough'), hashPassword('same-password-long-enough')]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^argon2id\$/);
  });
});

describe('sign-in', () => {
  const signIn = async (world: World, email: string, password: string) => {
    const { url } = await world.ready;
    const pre = await fetch(`${url}/v1/auth/csrf`);
    const preCookie = pre.headers.getSetCookie()[0].split(';')[0];
    const { token } = await pre.json() as { token: string };
    return fetch(`${url}/v1/auth/password`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: preCookie, ...json(token) }, body: JSON.stringify({ email, password }) });
  };

  it('answers the same way for a wrong password and an unknown address', async () => {
    const world = open();
    const wrong = await signIn(world, 'aoi@example.test', 'wrong-password-long-enough');
    const unknown = await signIn(world, 'nobody@example.test', 'wrong-password-long-enough');
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('issues a fresh HttpOnly session cookie on success', async () => {
    const world = open();
    const response = await signIn(world, 'aoi@example.test', 'current-password-long-enough');
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-fh_session='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('ends other sessions when the password changes', async () => {
    const world = open();
    await world.ready;
    world.deps.db.run("INSERT INTO sessions (id, token_hash, user_id, label, location, created_at, last_seen_at, expires_at) VALUES ('other', 'x', 'user-aoi', 'iPhone', '', '2026-09-30T00:00:00+09:00', '2026-09-30T00:00:00+09:00', '2027-01-01T00:00:00+09:00')");
    expect(await world.gateway.auth.changePassword('current-password-long-enough', 'a-brand-new-password-here')).toEqual({ ok: true, value: undefined });
    const overview = await world.gateway.auth.getSecurityOverview();
    expect(overview.ok && overview.value.sessions.map((item) => item.id)).toEqual(['session-member-aoi']);
  });
});

describe('role projection', () => {
  it('sends a child no budget, places or permission overrides', async () => {
    const snapshot = await open('member-hana').gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.expenses).toEqual([]);
    expect(snapshot.ok && snapshot.value.permissionOverrides).toEqual([]);
    expect(snapshot.ok && snapshot.value.memos.every((memo) => !('place' in memo))).toBe(true);
    expect(snapshot.ok && snapshot.value.user.id).toBe('user-hana');
  });

  it('keeps personal settings per person', async () => {
    const world = open();
    await world.gateway.household.savePrivacySettings({ defaultAudience: 'creator', hideNotificationContent: false, placeLookupConsent: null });
    expect(world.deps.db.get<{ body: string }>("SELECT body FROM records WHERE collection = 'meta' AND id = 'privacy:member-aoi'")?.body).toContain('creator');
    expect(world.deps.db.get("SELECT body FROM records WHERE collection = 'meta' AND id = 'privacy:member-ren'")).toBeUndefined();
  });
});
