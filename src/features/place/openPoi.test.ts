import { afterEach, describe, expect, it, vi } from 'vitest';
import { coarsen } from './geo';
import { createOpenPoiPlaceLookup, findNearbyPlaces, searchPlacesByName } from './openPoi';

const exact = { lat: 35.643_712, lng: 139.670_234 };
const facility = (name: string, lat: number | string, lng: number | string, extra: Record<string, unknown> = {}) => ({
  name, name_kana: '', prefecture: '東京都', city: '世田谷区', address: '東京都世田谷区太子堂', category: 'restaurant', business_type: 'restaurant',
  lat, lng, level: null, source: 'overture', licenses: ['CDLA-Permissive-2.0'], attributions: ['Overture Maps Foundation, overturemaps.org'], ...extra,
});
const respond = (body: unknown, status = 200) => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('OpenPOI adapter', () => {
  it('sends only a three-decimal center with no cookies, referrer, or caching', async () => {
    const fetchImpl = respond({ count: 0, results: [] });
    await findNearbyPlaces(createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch), exact);
    const [url, init] = fetchImpl.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://api.openpoiapi.com');
    expect(parsed.pathname).toBe('/v1/search');
    expect(parsed.searchParams.get('center')).toBe('139.670,35.644');
    expect(parsed.searchParams.get('limit')).toBe('200');
    expect(parsed.searchParams.get('radius')).toBe('380');
    expect(url).not.toContain('35.643712');
    expect(url).not.toContain('139.670234');
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors' });
  });

  it('sends an identical request for any exact position inside the same rounded cell', async () => {
    const fetchImpl = respond({ count: 0, results: [] });
    const lookup = createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch);
    await findNearbyPlaces(lookup, { lat: 35.643_51, lng: 139.668_51 });
    await findNearbyPlaces(lookup, { lat: 35.644_49, lng: 139.669_49 });
    expect(fetchImpl.mock.calls[0][0]).toBe(fetchImpl.mock.calls[1][0]);
  });

  it('rejects oversized response bodies before parsing', async () => {
    const fetchImpl = vi.fn(async () => new Response(`{"results":[${'0,'.repeat(1_000_001)}0]}`, { status: 200 }));
    expect(await createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch).nearby(coarsen(exact), 380)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_FAILURE', retryable: false } });
  });

  it('drops rows without usable coordinates or names and re-ranks by exact distance', async () => {
    const fetchImpl = respond({ count: 5, results: [
      facility('遠い店', 35.6460, 139.6702),
      facility('座標なし', '', ''),
      facility('', 35.6437, 139.6702),
      facility('近い店', '35.6438', '139.6703', { category: 'unknown' }),
      facility('範囲外', 95, 139),
    ] });
    const result = await findNearbyPlaces(createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch), exact);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.name)).toEqual(['近い店', '遠い店']);
    expect(result.value[0].category).toBeUndefined();
    expect(result.value[0].distanceMeters).toBeLessThan(30);
  });

  it('biases name search with the rounded center and reports nationwide fallback', async () => {
    const fetchImpl = respond({ count: 2, scope: 'nationwide', suggestions: [facility('函館朝市', 41.77, 140.72), facility('函館朝市', 41.77, 140.72)], licenses: [], attributions: [] });
    const result = await searchPlacesByName(createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch), '  函館朝市 ', exact);
    const parsed = new URL(fetchImpl.mock.calls[0][0]);
    expect(parsed.pathname).toBe('/v1/suggest');
    expect(parsed.searchParams.get('q')).toBe('函館朝市');
    expect(parsed.searchParams.get('center')).toBe('139.670,35.644');
    expect(result).toMatchObject({ ok: true, value: { nationwide: true } });
    if (result.ok) {
      expect(result.value.candidates).toHaveLength(1);
      expect(result.value.candidates[0].distanceMeters).toBeGreaterThan(600_000);
    }
  });

  it('searches without a center when no position is known and skips empty queries', async () => {
    const fetchImpl = respond({ count: 0, scope: 'nationwide', suggestions: [] });
    const lookup = createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch);
    expect(await lookup.search('   ', null)).toEqual({ ok: true, value: { candidates: [], nationwide: false } });
    expect(fetchImpl).not.toHaveBeenCalled();
    const result = await searchPlacesByName(lookup, 'カフェ', null);
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.has('center')).toBe(false);
    expect(result).toMatchObject({ ok: true, value: { nationwide: false } });
  });

  it('maps rate limits, upstream failures, malformed bodies, and network errors', async () => {
    const lookupWith = (fetchImpl: unknown) => createOpenPoiPlaceLookup(fetchImpl as typeof fetch);
    const center = coarsen(exact);
    expect(await lookupWith(respond({}, 429)).nearby(center, 300)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryable: true } });
    expect(await lookupWith(respond({}, 503)).nearby(center, 300)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_FAILURE', retryable: true } });
    expect(await lookupWith(respond({}, 400)).nearby(center, 300)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_FAILURE', retryable: false } });
    expect(await lookupWith(respond({ results: 'nope' })).nearby(center, 300)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_FAILURE' } });
    expect(await lookupWith(vi.fn(async () => { throw new TypeError('Failed to fetch'); })).nearby(center, 300)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_FAILURE' } });
  });

  it('does not send anything while the browser reports offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchImpl = respond({ results: [] });
    expect(await createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch).nearby(coarsen(exact), 300)).toMatchObject({ ok: false, error: { code: 'OFFLINE' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts when the caller cancels', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = createOpenPoiPlaceLookup(fetchImpl as unknown as typeof fetch).nearby(coarsen(exact), 300, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false });
  });
});
