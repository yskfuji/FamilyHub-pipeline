import { afterEach, describe, expect, it } from 'vitest';
import { SEARCH_LIMITS } from '../../src/domain/commands/search';
import { loadAggregate } from '../db/aggregateStore';
import { contract } from '../testing/contract';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

/**
 * 全体の検索の性能の上限（A17-6）。決まった環境（この開発機）で 200ms、CI では3倍。
 * FAMILY_HUB_SEARCH_BUDGET_MS で上書きできる。
 */
const SEARCH_BUDGET_MS = Number(process.env.FAMILY_HUB_SEARCH_BUDGET_MS) || (process.env.CI ? 3 : 1) * 200;
const ITEMS = 10_000;
const RUNS = 15;

const worlds: World[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map((world) => world.close())); });

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

describe('the household search contract (A17-4)', () => {
  it('writes the limit of each kind into the contract, and the rules use the same numbers', () => {
    const schema = (contract.paths['/v1/search'].get.responses['200'].content?.['application/json']?.schema ?? {}) as { maxItems?: number; 'x-limits-per-kind'?: Record<string, number>; items?: { properties?: { kind?: { enum?: string[] } } } };
    expect(schema['x-limits-per-kind']).toEqual(SEARCH_LIMITS);
    expect(schema.items?.properties?.kind?.enum).toEqual(Object.keys(SEARCH_LIMITS));
    expect(schema.maxItems).toBe(Object.values(SEARCH_LIMITS).reduce((sum, value) => sum + value, 0));
  });
});

describe('search performance with 10,000 photos (A17-6)', () => {
  it(`answers within ${SEARCH_BUDGET_MS}ms (median of ${RUNS}) and reads only what it searches`, async () => {
    const world = createWorld();
    worlds.push(world);
    await world.ready;
    const { db } = world.deps;
    // 1万件の準備ができた写真と、規則が捨てる項目（処理中・拒否・ごみ箱）を2千件。
    db.transaction(() => {
      for (let index = 0; index < ITEMS + 2000; index += 1) {
        const status = index < ITEMS ? 'ready' : ['processing', 'rejected', 'ready'][index % 3];
        const body = { id: `bulk-${index}`, albumId: index % 2 ? 'album-sports' : 'album-park', householdId: 'house-mori', kind: 'photo', originalName: `IMG_${String(index).padStart(5, '0')}.jpg`, mimeType: 'image/jpeg', byteSize: 2_000_000, width: 4032, height: 3024, takenAt: `2025-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}T10:00:00+09:00`, takenAtSource: 'exif-offset', sha256: 'a'.repeat(64), status, locationKept: false, hasThumbnail: true, uploaderMembershipId: 'member-aoi', position: index, createdAt: '2026-09-20T17:00:00+09:00', ...(index >= ITEMS && status === 'ready' ? { deletedAt: '2026-09-29T00:00:00+09:00' } : {}) };
        db.run('INSERT INTO records (household_id, collection, id, seq, body) VALUES (?, ?, ?, ?, ?)', 'house-mori', 'albumItems', body.id, 100 + index, JSON.stringify(body));
      }
    });
    const defaults = { privacy: { defaultAudience: 'household' as const, hideNotificationContent: true, placeLookupConsent: null }, notificationPreferences: { todoDue: true, eventDeparture: true, quietHours: true } };
    expect(loadAggregate(db, 'house-mori', 'member-aoi', defaults, { searchableMedia: true }).aggregate.albumItems).toHaveLength(ITEMS + 4);
    // 一致しない語（全件を照合する）と、多く一致する語（上限で止まる）。
    const timings: Record<string, number[]> = { none: [], many: [], date: [] };
    for (let run = 0; run < RUNS + 2; run += 1) {
      for (const [name, query] of [['none', 'zzz-no-match'], ['many', 'IMG_'], ['date', '2025年3月']] as const) {
        const started = performance.now();
        const result = await world.gateway.resources.search(query);
        const elapsed = performance.now() - started;
        expect(result.ok).toBe(true);
        if (name === 'many') expect(result.ok && result.value.filter((item) => item.kind === 'albumItem')).toHaveLength(SEARCH_LIMITS.albumItem);
        if (run >= 2) timings[name].push(elapsed);
      }
    }
    const medians = Object.fromEntries(Object.entries(timings).map(([name, values]) => [name, Math.round(median(values) * 10) / 10]));
    if (process.env.FAMILY_HUB_SEARCH_REPORT) process.stderr.write(`search medians (ms): ${JSON.stringify(medians)}\n`);
    for (const [name, value] of Object.entries(medians)) expect(value, name).toBeLessThanOrEqual(SEARCH_BUDGET_MS);
  }, 60_000);
});
