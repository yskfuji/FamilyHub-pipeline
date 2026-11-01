import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';
const STORAGE_KEY = 'family-hub-reduced-motion';

function subscribe(notify: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}

/** 端末の設定か、アプリの「動きを減らす」。アプリの設定は設定画面を開くまで画面に反映されないので、保存した値も見る。 */
const prefersReducedMotion = () => window.matchMedia(QUERY).matches
  || document.documentElement.dataset.reduceMotion === 'true'
  || localStorage.getItem(STORAGE_KEY) === 'true';

export const useReducedMotion = () => useSyncExternalStore(subscribe, prefersReducedMotion);
