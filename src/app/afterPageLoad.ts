/**
 * 最初の画面を描き終えてから取りに行くもの（通知、新しい版の確認、プライバシーの設定）のための待ち。
 * 遅い回線では、最初の画面に要らない要求が、画面に要る要求と回線を取り合うため（docs/audits/lcp-assessment.md）。
 *
 * 次の順に待つ。どこかで止まっても、5秒たてば進む。
 * 1. ページの load。
 * 2. 画面の本文を描いたこと（html の data-route-ready があり、「読み込んでいます」の画面ではない。src/app/routeLoading.tsx）。
 * 3. それを画面に出す次のフレーム。
 * 4. ブラウザが空いたとき（遅くとも1秒）。
 */
const LIMIT_MS = 5_000;
let ready: Promise<void> | undefined;

const frame = (next: () => void) => (typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(() => next()) : window.setTimeout(next, 16));
const idle = (next: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(() => next(), { timeout: 1000 }) : window.setTimeout(next, 0));
const routeShown = () => Boolean(document.documentElement.dataset.routeReady) && !document.querySelector('.stage-screen[aria-busy="true"]');

export function afterPageLoad(): Promise<void> {
  ready ??= new Promise<void>((resolve) => {
    const started = Date.now();
    let finished = false;
    const finish = () => { if (!finished) { finished = true; resolve(); } };
    window.setTimeout(finish, LIMIT_MS);
    const waitForRoute = () => {
      if (routeShown()) frame(() => frame(() => idle(finish)));
      else if (Date.now() - started < LIMIT_MS) frame(waitForRoute);
    };
    if (document.readyState === 'complete') waitForRoute();
    else window.addEventListener('load', waitForRoute, { once: true });
  });
  return ready;
}
