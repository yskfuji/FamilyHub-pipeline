import { describe, expect, it } from 'vitest';
import { placeRefSchema } from '../../domain/schemas';
import { NEARBY_RADIUS_METERS, candidateKey, coarsen, haversineMeters, rankCandidates, toPlaceRef, toRfc3339, type PlaceCandidate } from './geo';

const candidate = (name: string, lat: number, lng: number, extra: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
  key: candidateKey(name, extra.address ?? ''), name, address: '', lat, lng, source: 'overture', licenses: ['CDLA-Permissive-2.0'], attributions: ['Overture Maps Foundation, overturemaps.org'], ...extra,
});

describe('coarsen', () => {
  it('rounds to three decimals; the fixed radius always covers 300 m around the exact point', () => {
    for (let lat = 24; lat <= 46; lat += 0.731) {
      for (let lng = 123; lng <= 146; lng += 0.977) {
        const exact = { lat: lat + 0.000_444, lng: lng + 0.000_499 };
        const center = coarsen(exact);
        expect(center.lat.toString()).toMatch(/^-?\d+(\.\d{1,3})?$/);
        expect(haversineMeters(exact, center)).toBeLessThan(80);
        expect(NEARBY_RADIUS_METERS - haversineMeters(exact, center)).toBeGreaterThanOrEqual(300);
      }
    }
  });
});

describe('rankCandidates', () => {
  const origin = { lat: 35.6437, lng: 139.6702 };

  it('sorts by distance from the exact position and caps the list', () => {
    const items = Array.from({ length: 12 }, (_, index) => candidate(`店${index}`, origin.lat + (12 - index) * 0.0002, origin.lng));
    const ranked = rankCandidates(items, origin);
    expect(ranked).toHaveLength(8);
    expect(ranked[0].name).toBe('店11');
    expect(ranked.map((item) => item.distanceMeters)).toEqual([...ranked.map((item) => item.distanceMeters)].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('keeps only the nearer duplicate by normalized name and address, with its own provenance', () => {
    const ranked = rankCandidates([
      candidate('スターバックス　三軒茶屋店', origin.lat + 0.001, origin.lng, { licenses: ['Apache-2.0'] }),
      candidate('スターバックス 三軒茶屋店', origin.lat + 0.0001, origin.lng, { licenses: ['CC0-1.0'] }),
    ].map((item) => ({ ...item, key: candidateKey(item.name, item.address) })), origin);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].licenses).toEqual(['CC0-1.0']);
    expect(ranked[0].distanceMeters).toBeLessThan(20);
  });
});

describe('candidateKey', () => {
  it('is stable and distinguishes different places', () => {
    expect(candidateKey('Ａ店', '東京都')).toBe(candidateKey('A店', '東京都'));
    expect(candidateKey('A店', '東京都')).not.toBe(candidateKey('A店', '大阪府'));
    expect(candidateKey('A店', '東京都')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('toPlaceRef', () => {
  it('keeps only place data, rounds coordinates to five decimals, and passes the schema', () => {
    const ref = toPlaceRef(candidate('青葉書店', 35.643_712_345, 139.670_298_765, { address: '東京都世田谷区', category: 'retail_other' }), 'device', new Date('2026-10-03T03:00:00Z'));
    expect(ref.coordinates).toEqual({ lat: 35.64371, lng: 139.6703 });
    expect(ref.selectedAt).toBe('2026-10-03T12:00:00+09:00');
    expect(ref.category).toBe('retail_other');
    expect(placeRefSchema.safeParse(ref).success).toBe(true);
  });

  it('drops categories that have no Japanese label, including prototype keys', () => {
    for (const category of ['mystery_slug', 'constructor', 'toString', '__proto__']) {
      expect(toPlaceRef(candidate('X', 35, 139, { category }), 'search', new Date()).category).toBeUndefined();
    }
  });

  it('formats JST timestamps', () => {
    expect(toRfc3339(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01T07:30:00+09:00');
  });
});
