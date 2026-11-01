import { useCallback, useEffect, useState } from 'react';

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

export function useCloseTo(base: string) {
  return useCallback(() => navigate(base), [base]);
}

export function detailId(path: string, base: string) {
  const prefix = `${base}/`;
  return path.startsWith(prefix) ? decodeURIComponent(path.slice(prefix.length).split('/')[0]) : null;
}
