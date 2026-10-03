import { COARSE_ACCURACY_METERS, type ExactPosition } from './geo';

export type DeviceLocationOutcome =
  | { ok: true; position: ExactPosition; accuracyMeters: number; coarse: boolean }
  | { ok: false; reason: 'unsupported' | 'denied' | 'unavailable' | 'timeout' };

/** 端末の種類は判定せず、機能があるかだけを見る（iPadOS は Mac と名乗るなど、端末判定は壊れやすい）。 */
export function isGeolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator && (typeof isSecureContext === 'undefined' || isSecureContext);
}

/**
 * 利用者がボタンを押したときに一度だけ現在地を取得する。継続的な追跡はしない。
 * accuracy は「95%の確率でこの半径内」を表すメートル値（W3C Geolocation）。
 */
export function getDevicePosition(signal?: AbortSignal): Promise<DeviceLocationOutcome> {
  if (!isGeolocationAvailable()) return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: DeviceLocationOutcome) => { if (!settled) { settled = true; resolve(outcome); } };
    signal?.addEventListener('abort', () => finish({ ok: false, reason: 'unavailable' }), { once: true });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => finish({
        ok: true,
        position: { lat: coords.latitude, lng: coords.longitude },
        accuracyMeters: coords.accuracy,
        coarse: !Number.isFinite(coords.accuracy) || coords.accuracy > COARSE_ACCURACY_METERS,
      }),
      (error) => finish({ ok: false, reason: error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
