import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { askToLeave, guardLeaving, hasUnsavedForms } from '../design-system/unsavedGuard';
import { runViewTransition } from './viewTransition';

const hereUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;
/** アプリの中の移動で送る合図。ブラウザの戻る・進むと区別する。 */
let internalMove = false;
/** 確認のあとに自分で履歴を動かすとき。 */
let confirmedMove = false;
/** 今表示している URL。戻るを止めるときに元へ戻す先。 */
let shownUrl = '';

/** 押したリンク。一覧から詳細へ移るとき、その題名を遷移で動かす。 */
let transitionSource: Element | null = null;

/**
 * keepScroll は、同じ画面の中の移動で読んでいた位置を保つとき。
 * パスが変わる移動（画面の切り替え、一覧から詳細）は View Transitions で切り替える。クエリだけの変更（絞り込み）と、詳細を閉じて一覧へ戻る移動は動かさない。
 * URL は先に変えるので、URL がいつも表示の元になる。
 */
export function navigate(to: string, replace = false, keepScroll = false) {
  const before = window.location.pathname;
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  shownUrl = hereUrl();
  const apply = () => {
    internalMove = true;
    window.dispatchEvent(new PopStateEvent('popstate'));
    internalMove = false;
    if (!keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const after = window.location.pathname;
  // 詳細を閉じて一覧へ戻るとき（/notes/x → /notes）は、すぐに切り替える。一覧はもう見えているので、動かすと操作が1フレーム遅れるだけになる。
  const closingDetail = before.startsWith(`${after}/`);
  if (after === before || closingDetail) apply();
  else runViewTransition(apply, transitionSource);
}

/** 利用者の操作で別の画面へ移る。保存していない入力があれば先に確かめる。 */
export const navigateGuarded = (to: string, keepScroll = false) => guardLeaving(() => navigate(to, false, keepScroll), to);

/**
 * ブラウザの戻る・進むは起きたあとにしか分からない。保存していない入力があれば、
 * 元の URL を積み直して画面を残し、確認のあとで同じ移動をやり直す。
 */
function holdHistoryMove(event: PopStateEvent) {
  if (internalMove) return;
  if (confirmedMove || !hasUnsavedForms(hereUrl())) { confirmedMove = false; shownUrl = hereUrl(); return; }
  event.stopImmediatePropagation();
  window.history.pushState({}, '', shownUrl);
  askToLeave(() => { confirmedMove = true; window.history.go(-1); });
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    shownUrl = hereUrl();
    const update = () => setPath(window.location.pathname);
    const click = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest<HTMLAnchorElement>('a[data-link]');
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault();
      transitionSource = anchor;
      try { navigateGuarded(`${url.pathname}${url.search}${url.hash}`, anchor.hasAttribute('data-keep-scroll')); } finally { transitionSource = null; }
    };
    window.addEventListener('popstate', holdHistoryMove, true);
    window.addEventListener('popstate', update);
    document.addEventListener('click', click);
    return () => { window.removeEventListener('popstate', holdHistoryMove, true); window.removeEventListener('popstate', update); document.removeEventListener('click', click); };
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
