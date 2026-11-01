import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** keepScroll は、同じ画面の中の移動で読んでいた位置を保つとき。 */
export function navigate(to: string, replace = false, keepScroll = false) {
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    const click = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>('a[data-link]');
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      navigate(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener('popstate', update);
    document.addEventListener('click', click);
    return () => { window.removeEventListener('popstate', update); document.removeEventListener('click', click); };
  }, []);
  return path;
}

function subscribeToLocation(notify: () => void) {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
}

/** 今の URL のクエリ（先頭の ? を含む）。一覧と詳細のあいだで絞り込みを保つために使う。 */
export function useSearch() {
  return useSyncExternalStore(subscribeToLocation, () => window.location.search);
}

/** 今のパスのまま、クエリの1項目を変えた URL。null で項目を外す。 */
export function withQueryParam(name: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value === null) params.delete(name); else params.set(name, value);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

export function useCloseTo(base: string) {
  return useCallback(() => navigate(base), [base]);
}

export function detailId(path: string, base: string) {
  const prefix = `${base}/`;
  return path.startsWith(prefix) ? decodeURIComponent(path.slice(prefix.length).split('/')[0]) : null;
}
