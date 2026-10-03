import { z } from 'zod';
import type { GatewayError, Result } from '../../domain/types';
import { ja } from '../../content/ja';
import { NEARBY_RADIUS_METERS, candidateKey, coarsen, haversineMeters, rankCandidates, type CoarseCenter, type ExactPosition, type PlaceCandidate } from './geo';

/**
 * 外部の場所検索（OpenPOI API）への唯一の出口。
 * 送るのは丸めた位置（CoarseCenter）と検索語だけ。Cookie・リファラーは送らず、応答もキャッシュしない。
 */
const API_ORIGIN = 'https://api.openpoiapi.com';
export const OPENPOI_ATTRIBUTION_URL = 'https://openpoiapi.com/attribution.html';
export const OPENPOI_TERMS_URL = 'https://docs.openpoiapi.com/legal.html';
/** 外部送信の説明を変えたら更新し、全員に同意を取り直す。 */
export const PLACE_LOOKUP_NOTICE_VERSION = '2026-10-03';

const NEARBY_LIMIT = 200;
const SEARCH_LIMIT = 20;
const SEARCH_RADIUS_METERS = 5000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_QUERY_LENGTH = 60;
/** 応答本文の上限。上限200件の正常な応答は数百KBに収まる。 */
const MAX_RESPONSE_CHARS = 2_000_000;

export interface PlaceLookupPort {
  nearby(center: CoarseCenter, radiusMeters: number, signal?: AbortSignal): Promise<Result<PlaceCandidate[]>>;
  search(query: string, center: CoarseCenter | null, signal?: AbortSignal): Promise<Result<{ candidates: PlaceCandidate[]; nationwide: boolean }>>;
}

const coordinate = z.union([z.number(), z.string()]).transform((value) => (value === '' ? Number.NaN : Number(value)));
const facilitySchema = z.object({
  name: z.string().catch(''),
  address: z.string().catch(''),
  category: z.string().optional().catch(undefined),
  lat: coordinate.catch(Number.NaN),
  lng: coordinate.catch(Number.NaN),
  source: z.string().catch(''),
  licenses: z.array(z.string()).catch([]),
  attributions: z.array(z.string()).catch([]),
});
const searchResponseSchema = z.object({ results: z.array(z.unknown()).max(NEARBY_LIMIT) });
const suggestResponseSchema = z.object({ scope: z.string().optional(), suggestions: z.array(z.unknown()).max(SEARCH_LIMIT) });

function toCandidates(rows: unknown[]): PlaceCandidate[] {
  const candidates: PlaceCandidate[] = [];
  for (const row of rows) {
    const parsed = facilitySchema.safeParse(row);
    if (!parsed.success) continue;
    const { name, address, category, lat, lng, source, licenses, attributions } = parsed.data;
    const trimmedName = name.trim().slice(0, 120);
    if (!trimmedName || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const trimmedAddress = address.trim().slice(0, 200);
    candidates.push({
      key: candidateKey(trimmedName, trimmedAddress),
      name: trimmedName,
      address: trimmedAddress,
      lat,
      lng,
      ...(category && category !== 'unknown' ? { category: category.slice(0, 40) } : {}),
      source: source.slice(0, 40) || 'unknown',
      licenses: licenses.filter((item) => item.length > 0 && item.length <= 200).slice(0, 10),
      attributions: attributions.filter((item) => item.length > 0 && item.length <= 300).slice(0, 20),
    });
  }
  return candidates;
}

const failure = (code: GatewayError['code'], retryable: boolean): Result<never> => ({ ok: false, error: { code, message: ja.errors[code], retryable } });
const centerParam = (center: CoarseCenter) => `${center.lng.toFixed(3)},${center.lat.toFixed(3)}`;

export function createOpenPoiPlaceLookup(fetchImpl: typeof fetch = (...args) => fetch(...args)): PlaceLookupPort {
  async function getJson(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Result<unknown>> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return failure('OFFLINE', true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      const response = await fetchImpl(`${API_ORIGIN}${path}?${new URLSearchParams(params).toString()}`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 429) return failure('RATE_LIMITED', true);
      if (!response.ok) return failure('UPSTREAM_FAILURE', response.status >= 500);
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) return failure('UPSTREAM_FAILURE', false);
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return failure('OFFLINE', true);
      return failure('UPSTREAM_FAILURE', true);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  return {
    async nearby(center, radiusMeters, signal) {
      const result = await getJson('/v1/search', { center: centerParam(center), radius: String(Math.max(1, Math.round(radiusMeters))), limit: String(NEARBY_LIMIT) }, signal);
      if (!result.ok) return result;
      const parsed = searchResponseSchema.safeParse(result.value);
      return parsed.success ? { ok: true, value: toCandidates(parsed.data.results) } : failure('UPSTREAM_FAILURE', true);
    },
    async search(query, center, signal) {
      const q = query.trim().slice(0, MAX_QUERY_LENGTH);
      if (!q) return { ok: true, value: { candidates: [], nationwide: false } };
      const params: Record<string, string> = { q, limit: String(SEARCH_LIMIT), fields: 'full' };
      if (center) Object.assign(params, { center: centerParam(center), radius: String(SEARCH_RADIUS_METERS) });
      const result = await getJson('/v1/suggest', params, signal);
      if (!result.ok) return result;
      const parsed = suggestResponseSchema.safeParse(result.value);
      if (!parsed.success) return failure('UPSTREAM_FAILURE', true);
      const seen = new Set<string>();
      const candidates = toCandidates(parsed.data.suggestions).filter((candidate) => !seen.has(candidate.key) && seen.add(candidate.key));
      return { ok: true, value: { candidates, nationwide: center !== null && parsed.data.scope === 'nationwide' } };
    },
  };
}

export const openPoiPlaceLookup: PlaceLookupPort = createOpenPoiPlaceLookup();

/** 丸めた中心と固定の半径だけで問い合わせ、返ってきた候補を正確な位置から近い順に並べ直す。 */
export async function findNearbyPlaces(port: PlaceLookupPort, exact: ExactPosition, signal?: AbortSignal): Promise<Result<PlaceCandidate[]>> {
  const result = await port.nearby(coarsen(exact), NEARBY_RADIUS_METERS, signal);
  return result.ok ? { ok: true, value: rankCandidates(result.value, exact) } : result;
}

/** 名前で探す。位置が分かっていれば丸めた位置で近くを優先し、表示用の距離だけ端末内で計算する。 */
export async function searchPlacesByName(port: PlaceLookupPort, query: string, exact: ExactPosition | null, signal?: AbortSignal): Promise<Result<{ candidates: PlaceCandidate[]; nationwide: boolean }>> {
  const result = await port.search(query, exact ? coarsen(exact) : null, signal);
  if (!result.ok || !exact) return result;
  return { ok: true, value: { ...result.value, candidates: result.value.candidates.map((candidate) => ({ ...candidate, distanceMeters: haversineMeters(exact, candidate) })) } };
}
