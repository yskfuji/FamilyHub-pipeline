import type { PlaceCaptureSource, PlaceRef } from '../../domain/types';
import { ja } from '../../content/ja';

/** 端末や写真から得た正確な位置。端末の外へ出さない。 */
export interface ExactPosition { readonly lat: number; readonly lng: number }

declare const coarseBrand: unique symbol;
/** 外部へ送ってよい、丸め済みの位置。coarsen() だけが作れる。 */
export type CoarseCenter = { readonly lat: number; readonly lng: number; readonly [coarseBrand]: true };

export interface PlaceCandidate {
  key: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: string;
  source: string;
  licenses: string[];
  attributions: string[];
  distanceMeters?: number;
}

/** 誤差（95%半径）がこれを超える位置では、近くの候補を出さず名前で探してもらう。 */
export const COARSE_ACCURACY_METERS = 1000;
/** 誤差がこれを超えるときは、候補がずれうることを知らせる。 */
export const APPROXIMATE_ACCURACY_METERS = 100;
export const NEARBY_BASE_RADIUS_METERS = 300;
export const MAX_VISIBLE_CANDIDATES = 8;

const COARSE_FACTOR = 1e3;
const STORED_FACTOR = 1e5;
const EARTH_RADIUS_METERS = 6_371_008.8;

const roundTo = (value: number, factor: number) => Math.round(value * factor) / factor;

/** 小数第3位（日本の緯度で約110m×90m）に丸める。外部へ送る位置はすべてここを通す。 */
export function coarsen(position: ExactPosition): CoarseCenter {
  return { lat: roundTo(position.lat, COARSE_FACTOR), lng: roundTo(position.lng, COARSE_FACTOR) } as CoarseCenter;
}

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 丸めでずれた分だけ半径を広げ、正確な位置の周囲300mを取りこぼさないようにする。 */
export function nearbyRadius(exact: ExactPosition, center: CoarseCenter): number {
  return NEARBY_BASE_RADIUS_METERS + Math.ceil(haversineMeters(exact, center));
}

const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/** 名前と住所から作る安定したキー（FNV-1a 32bit）。外部データに ID がないため、表示と操作 ID に使う。 */
export function candidateKey(name: string, address: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${normalize(name)}|${normalize(address)}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** 同じ名前・住所の重複をまとめ、正確な位置から近い順に並べる（外部の並び順は距離順ではない）。 */
export function rankCandidates(candidates: PlaceCandidate[], from: ExactPosition, limit = MAX_VISIBLE_CANDIDATES): PlaceCandidate[] {
  const byKey = new Map<string, PlaceCandidate>();
  for (const candidate of candidates) {
    const withDistance = { ...candidate, distanceMeters: haversineMeters(from, candidate) };
    const existing = byKey.get(candidate.key);
    if (!existing) { byKey.set(candidate.key, withDistance); continue; }
    const nearer = (withDistance.distanceMeters ?? Infinity) < (existing.distanceMeters ?? Infinity) ? withDistance : existing;
    byKey.set(candidate.key, { ...nearer, licenses: union(existing.licenses, candidate.licenses), attributions: union(existing.attributions, candidate.attributions) });
  }
  return [...byKey.values()]
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0) || a.name.localeCompare(b.name, 'ja'))
    .slice(0, limit);
}

/** 記録用の形に変える。場所の座標は小数第5位（約1m）にそろえ、利用者自身の位置は含めない。 */
export function toPlaceRef(candidate: PlaceCandidate, via: Exclude<PlaceCaptureSource, 'manual'>, now: Date): PlaceRef {
  return {
    name: candidate.name,
    ...(candidate.address ? { address: candidate.address } : {}),
    coordinates: { lat: roundTo(candidate.lat, STORED_FACTOR), lng: roundTo(candidate.lng, STORED_FACTOR) },
    ...(candidate.category && ja.place.categories[candidate.category] ? { category: candidate.category } : {}),
    provenance: { provider: 'openpoi', source: candidate.source, licenses: candidate.licenses.slice(0, 10), attributions: candidate.attributions.slice(0, 20) },
    capturedVia: via,
    selectedAt: toRfc3339(now),
  };
}

/** 日本時間のオフセット付き RFC 3339。 */
export function toRfc3339(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.toISOString().slice(0, 19)}+09:00`;
}
