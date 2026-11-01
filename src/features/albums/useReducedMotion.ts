import { useSyncExternalStore } from 'react';
import { devicePreferences, subscribeDevicePreferences } from '../../app/devicePreferences';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(notify: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  const stop = subscribeDevicePreferences(notify);
  return () => { media.removeEventListener('change', notify); stop(); };
}

/** 端末の設定か、アプリの「動きを減らす」。 */
const prefersReducedMotion = () => window.matchMedia(QUERY).matches || devicePreferences().reducedMotion;

export const useReducedMotion = () => useSyncExternalStore(subscribe, prefersReducedMotion);
