import { useSyncExternalStore } from 'react';
import { parseMemberScope, type MemberScope } from '../domain/memberScope';
import { isNightTheme, paletteOf, parseTheme, themeFor, type ColorMode, type ThemePalette } from '../domain/theme';
import type { Theme } from '../domain/types';

/** 表示の詰め具合。 */
export type Density = 'comfortable' | 'compact';

/** この端末だけに保存する設定。家族やアカウントとは共有しない。 */
export interface DevicePreferences {
  palette: ThemePalette;
  colorMode: ColorMode;
  density: Density;
  reducedMotion: boolean;
  privacyBlur: boolean;
  keepPhotoLocation: boolean;
  memberScope: MemberScope;
}

const keys = {
  theme: 'family-hub-theme',
  followSystem: 'family-hub-theme-follow-system',
  density: 'family-hub-density',
  reducedMotion: 'family-hub-reduced-motion',
  privacyBlur: 'family-hub-privacy-blur',
  keepPhotoLocation: 'family-hub-keep-photo-location',
  memberScope: 'family-hub-member-scope',
} as const;

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 保存の領域が使えないブラウザでも、既定の値で動かす。 */
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* この画面の間だけ有効にする */ } };

function readPreferences(): DevicePreferences {
  const stored = read(keys.theme);
  const theme = parseTheme(stored);
  return {
    palette: paletteOf(theme),
    // まだ選んでいないときは、端末の昼と夜の設定に従う（iPhone のシミュレーターで、夜の表示の端末でも昼の色になっていた）。
    colorMode: read(keys.followSystem) === 'true' || stored === null ? 'system' : isNightTheme(theme) ? 'night' : 'day',
    density: read(keys.density) === 'compact' ? 'compact' : 'comfortable',
    reducedMotion: read(keys.reducedMotion) === 'true',
    privacyBlur: read(keys.privacyBlur) === 'true',
    keepPhotoLocation: read(keys.keepPhotoLocation) === 'true',
    memberScope: parseMemberScope(read(keys.memberScope)),
  };
}

function writePreferences(next: DevicePreferences) {
  write(keys.theme, themeFor(next.palette, next.colorMode === 'night'));
  write(keys.followSystem, String(next.colorMode === 'system'));
  write(keys.density, next.density);
  write(keys.reducedMotion, String(next.reducedMotion));
  write(keys.privacyBlur, String(next.privacyBlur));
  write(keys.keepPhotoLocation, String(next.keepPhotoLocation));
  write(keys.memberScope, next.memberScope);
}

export interface DeviceState extends DevicePreferences {
  /** 今の画面に当たっている配色。 */
  theme: Theme;
  night: boolean;
}

const osPrefersDark = () => window.matchMedia(DARK_QUERY).matches;
const resolve = (preferences: DevicePreferences): DeviceState => {
  const night = preferences.colorMode === 'system' ? osPrefersDark() : preferences.colorMode === 'night';
  return { ...preferences, theme: themeFor(preferences.palette, night), night };
};

let current: DeviceState | null = null;
const listeners = new Set<() => void>();
const state = () => { current ??= resolve(readPreferences()); return current; };

function syncHiddenBlur() {
  const hidden = state().privacyBlur && document.visibilityState === 'hidden';
  if (hidden) document.documentElement.dataset.privacyHidden = 'true';
  else delete document.documentElement.dataset.privacyHidden;
}

function applyToDocument() {
  const { theme, density, reducedMotion } = state();
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.density = density;
  root.dataset.reduceMotion = String(reducedMotion);
  syncHiddenBlur();
}

function commit(next: DeviceState) {
  current = next;
  applyToDocument();
  listeners.forEach((listener) => listener());
}

/** 変えた項目だけを保存し、すぐ画面へ反映する。 */
export function setDevicePreferences(patch: Partial<DevicePreferences>) {
  const next = resolve({ ...state(), ...patch });
  writePreferences(next);
  commit(next);
}

/** 最初の描画の前に呼ぶ。保存した配色と「動きを減らす」は、設定の画面を開かなくても効く。 */
export function startDevicePreferences() {
  applyToDocument();
  window.matchMedia(DARK_QUERY).addEventListener('change', () => commit(resolve(state())));
  document.addEventListener('visibilitychange', syncHiddenBlur);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const useDevicePreferences = () => useSyncExternalStore(subscribe, state);
export const subscribeDevicePreferences = subscribe;
export const devicePreferences = state;
