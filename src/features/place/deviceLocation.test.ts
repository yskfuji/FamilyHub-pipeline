import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDevicePosition, isGeolocationAvailable } from './deviceLocation';

type Success = (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type Failure = (error: { code: number }) => void;

function stubGeolocation(run: (success: Success, failure: Failure, options?: PositionOptions) => void) {
  const getCurrentPosition = vi.fn(run);
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() } });
  return getCurrentPosition;
}

afterEach(() => vi.unstubAllGlobals());

describe('getDevicePosition', () => {
  it('requests a single high-accuracy fix and reports precise positions', async () => {
    const spy = stubGeolocation((success) => success({ coords: { latitude: 35.6437, longitude: 139.6702, accuracy: 18 } }));
    expect(await getDevicePosition()).toEqual({ ok: true, position: { lat: 35.6437, lng: 139.6702 }, accuracyMeters: 18 });
    expect(spy.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 });
  });

  it('reports the accuracy of approximate positions (e.g. iOS Precise Location off) and treats a missing value as unbounded', async () => {
    stubGeolocation((success) => success({ coords: { latitude: 35.6, longitude: 139.7, accuracy: 4800 } }));
    expect(await getDevicePosition()).toMatchObject({ ok: true, accuracyMeters: 4800 });
    stubGeolocation((success) => success({ coords: { latitude: 35.6, longitude: 139.7, accuracy: Number.NaN } }));
    expect(await getDevicePosition()).toMatchObject({ ok: true, accuracyMeters: Number.POSITIVE_INFINITY });
  });

  it.each([[1, 'denied'], [2, 'unavailable'], [3, 'timeout']])('maps error code %i to %s', async (code, reason) => {
    stubGeolocation((_success, failure) => failure({ code }));
    expect(await getDevicePosition()).toEqual({ ok: false, reason });
  });

  it('reports unsupported browsers without calling the API', async () => {
    vi.stubGlobal('navigator', {});
    expect(isGeolocationAvailable()).toBe(false);
    expect(await getDevicePosition()).toEqual({ ok: false, reason: 'unsupported' });
  });
});
