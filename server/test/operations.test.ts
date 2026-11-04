import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWeatherSource } from '../adapters/weather';
import { generateNotifications, runRetention } from '../jobs';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

const worlds: World[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(worlds.splice(0).map((world) => world.close())); });
const open = (actor?: string) => { const world = createWorld(actor); worlds.push(world); return world; };

describe('retention', () => {
  it('removes records 30 days after deletion and keeps younger ones', async () => {
    const world = open();
    await world.gateway.memos.deleteMemo('memo-receipt');
    await world.gateway.todos.createTodo({ title: '残す', assigneeMembershipId: 'member-aoi' });
    const old = '2026-08-01T00:00:00+09:00';
    world.deps.db.run("UPDATE records SET body = json_set(body, '$.deletedAt', ?) WHERE collection = 'events' AND id = 'event-park'", old);
    world.deps.db.run("UPDATE records SET body = json_set(body, '$.deletedAt', ?) WHERE collection = 'albums' AND id = 'album-park'", old);
    await runRetention(world.deps);
    const ids = (collection: string) => world.deps.db.all<{ id: string }>('SELECT id FROM records WHERE collection = ?', collection).map((row) => row.id);
    expect(ids('events')).not.toContain('event-park');
    expect(ids('albums')).not.toContain('album-park');
    expect(ids('albumItems')).not.toContain('item-park-1');
    expect(ids('memos')).toContain('memo-receipt');
  });

  it('compares stored times as instants, whichever offset they were written with', async () => {
    const world = open();
    await world.ready;
    // 現在は 2026-09-30T07:45+09:00。UTC で書いた未来の期限は、文字列では過去に見える。
    world.deps.db.run("INSERT INTO webauthn_challenges (id, purpose, challenge, expires_at) VALUES ('future', 'sign-in', 'x', '2026-09-30T00:00:00.000Z')");
    world.deps.db.run("INSERT INTO webauthn_challenges (id, purpose, challenge, expires_at) VALUES ('past', 'sign-in', 'x', '2026-09-29T20:00:00.000Z')");
    await runRetention(world.deps);
    expect(world.deps.db.all<{ id: string }>('SELECT id FROM webauthn_challenges').map((row) => row.id)).toEqual(['future']);
  });

  it('clears old idempotency records and sessions', async () => {
    const world = open();
    await world.ready;
    world.deps.db.run("INSERT INTO idempotency_records (scope, key, request_hash, status, created_at) VALUES ('u', 'k', 'h', 200, '2026-01-01T00:00:00+09:00')");
    await runRetention(world.deps);
    expect(world.deps.db.get('SELECT key FROM idempotency_records')).toBeUndefined();
  });
});

describe('notifications', () => {
  it('creates reminders once per person and only for what they can see', async () => {
    const world = open();
    await world.ready;
    generateNotifications(world.deps);
    generateNotifications(world.deps);
    const rows = world.deps.db.all<{ id: string; body: string }>("SELECT id, body FROM records WHERE collection = 'notifications'");
    expect(rows.filter((row) => row.id.startsWith('todoDue:todo-form'))).toHaveLength(1);
    expect(rows.some((row) => row.id.startsWith('todoDue:todo-garbage') && JSON.parse(row.body).recipientMembershipId === 'member-aoi')).toBe(false);
  });
});

describe('weather', () => {
  it('reports unavailable until fetched, serves stale data on failure, and never throws', async () => {
    let now = 0;
    const fetchMock = vi.fn(async () => Response.json({ current: { temperature_2m: 21.4, weather_code: 61 }, hourly: { precipitation_probability: [10, 70] } }));
    vi.stubGlobal('fetch', fetchMock);
    const source = createWeatherSource(() => now);
    expect(source.current()).toMatchObject({ unavailable: true });
    await source.refresh();
    expect(source.current()).toMatchObject({ condition: 'rain', temperatureC: 21, precipitationPercent: 70 });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    now = 3_600_000;
    await source.refresh();
    expect(source.current()).toMatchObject({ condition: 'rain' });
    fetchMock.mockRejectedValue(new Error('down'));
    now = 8 * 3_600_000;
    source.current();
    expect(source.current()).toMatchObject({ unavailable: true });
  });
});

describe('snapshot context', () => {
  it('includes computed holidays and the weather source', async () => {
    const snapshot = await open().gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.context.holidays.map((item) => item.name)).toContain('スポーツの日');
    expect(snapshot.ok && snapshot.value.context.weather.alert).toBe('見本の天気');
  });
});
