import type { ContextSnapshot } from '../../src/domain/types';
import { serverMessages } from '../../src/content/serverMessages';

export type Weather = ContextSnapshot['weather'];
const FRESH_MS = 30 * 60_000;
const STALE_MS = 6 * 3_600_000;
const TIMEOUT_MS = 4000;

/** Open-Meteo の天気コードを、画面の3つの区分へまとめる。 */
function conditionOf(code: number): Weather['condition'] {
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  return 'sunny';
}

export interface WeatherSource { current(): Weather; refresh(): Promise<void> }

const unavailable: Weather = { location: serverMessages.defaultWeatherPlace, condition: 'sunny', temperatureC: 0, precipitationPercent: 0, unavailable: true };

/** 外部の天気の取得はこのファイルだけで行う。要求を待たせないよう、古ければ裏で取り直す。 */
export function createWeatherSource(now: () => number, endpoint = 'https://api.open-meteo.com/v1/forecast', location = { name: serverMessages.defaultWeatherPlace, latitude: 35.68, longitude: 139.77 }): WeatherSource {
  let cached: { value: Weather; at: number } | null = null;
  let running: Promise<void> | null = null;
  const refresh = () => {
    running ??= (async () => {
      try {
        const url = `${endpoint}?${new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: 'temperature_2m,weather_code', hourly: 'precipitation_probability', forecast_hours: '12', timezone: 'Asia/Tokyo' })}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
        if (!response.ok) return;
        const body = await response.json() as { current: { temperature_2m: number; weather_code: number }; hourly: { precipitation_probability: Array<number | null> } };
        const percent = Math.max(0, ...body.hourly.precipitation_probability.map((value) => value ?? 0));
        const condition = percent >= 60 && body.current.weather_code < 51 ? 'rain' : conditionOf(body.current.weather_code);
        cached = { at: now(), value: { location: location.name, condition, temperatureC: Math.round(body.current.temperature_2m), precipitationPercent: percent, ...(condition === 'sunny' ? {} : { alert: condition === 'storm' ? serverMessages.stormAlert : serverMessages.rainAlert(percent) }) } };
      } catch {
        // 取得できないときは前の値を使い続ける（下で期限を見る）。
      } finally {
        running = null;
      }
    })();
    return running;
  };
  return {
    current() {
      const age = cached ? now() - cached.at : Infinity;
      if (age > FRESH_MS) void refresh();
      return cached && age <= STALE_MS ? cached.value : unavailable;
    },
    refresh,
  };
}
