import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { signIn } from './support';

/**
 * 性能の予算（docs/acceptance/criteria.md の B「性能」）。dist-http にサインインした状態で、主要5画面を空のキャッシュから開く。
 * - JS: 画面の表示（LCP と、画面の見出しが見えた時点の遅い方）までに届いたスクリプトの本文を gzip -6 で圧縮した合計。150,000 バイト以下。
 *   index.html の入口・modulepreload・実行された動的 import がすべて入る。表示の後に読むもの（送信の時に読む一覧など）は入れない。
 * - 書体: 通信が落ち着くまでに届いた woff2 の合計。400,000 バイト以下。
 * vite preview は圧縮せずに配るので、本文をここで gzip -6 にする（配信の gzip_static は -9 で作るので、実際はこれより小さい）。
 */
const JS_BUDGET = 150_000;
const FONT_BUDGET = 400_000;
const screens = [
  ['today', '/today'],
  ['calendar', '/calendar'],
  ['budget', '/budget'],
  ['albums', '/albums'],
  ['notes', '/notes'],
] as const;

interface Loaded { url: string; kind: 'script' | 'font'; bytes: number; gzip6: number }
interface ScreenResult {
  screen: string;
  path: string;
  lcpMs: number;
  readyMs: number;
  jsBeforeLcpGzip6: number;
  jsTotalGzip6: number;
  jsTotalRaw: number;
  woff2Bytes: number;
  chunksBeforeLcp: string[];
  chunksAfterLcp: string[];
  fonts: string[];
}

const fileName = (url: string) => new URL(url).pathname.replace(/^\/assets\//, '');

/** スクリプトと書体の応答を集める。本文は応答ごとに読む（キャッシュはない）。 */
function collect(page: Page) {
  const loaded: Promise<Loaded | null>[] = [];
  page.on('response', (response) => {
    const type = response.request().resourceType();
    const url = response.url();
    const kind = type === 'script' ? 'script' : type === 'font' || url.endsWith('.woff2') ? 'font' : null;
    if (!kind || !url.startsWith('http') || url.includes('/v1/')) return;
    loaded.push(response.body().then((body) => ({ url, kind, bytes: body.length, gzip6: kind === 'script' ? gzipSync(body, { level: 6 }).length : body.length })).catch(() => null));
  });
  return async () => (await Promise.all(loaded)).filter((item): item is Loaded => item !== null);
}

async function freshContext(browser: Browser, storageState: Awaited<ReturnType<BrowserContext['storageState']>>) {
  // 新しい文脈はキャッシュも service worker も持たない。
  return browser.newContext({ storageState, serviceWorkers: 'block' });
}

async function measure(page: Page, screen: string, path: string): Promise<ScreenResult> {
  await page.addInitScript(() => {
    const store = window as unknown as { __lcp: number };
    store.__lcp = 0;
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) store.__lcp = Math.max(store.__lcp, entry.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const done = collect(page);
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}`));
  await expect(page.locator('main h1, #main h1, h1').first()).toBeVisible();
  const readyMs = await page.evaluate(() => performance.now());
  await page.waitForLoadState('networkidle');
  // LCP は入力のない間は更新され続けるので、落ち着いてから読む。
  await page.waitForTimeout(300);
  const { lcpMs, timings } = await page.evaluate(() => ({
    lcpMs: (window as unknown as { __lcp: number }).__lcp,
    timings: performance.getEntriesByType('resource').map((entry) => [entry.name, (entry as PerformanceResourceTiming).responseEnd] as const),
  }));
  const loaded = await done();
  const ended = new Map(timings);
  const cutoff = Math.max(lcpMs, readyMs);
  const scripts = loaded.filter((item) => item.kind === 'script');
  // index.html の入口は navigation の一部で、resource の記録がないことがある。その場合は表示の前に届いたとみなす。
  const before = scripts.filter((item) => (ended.get(item.url) ?? 0) <= cutoff);
  const after = scripts.filter((item) => !before.includes(item));
  const fonts = loaded.filter((item) => item.kind === 'font');
  return {
    screen,
    path,
    lcpMs: Math.round(lcpMs),
    readyMs: Math.round(readyMs),
    jsBeforeLcpGzip6: before.reduce((sum, item) => sum + item.gzip6, 0),
    jsTotalGzip6: scripts.reduce((sum, item) => sum + item.gzip6, 0),
    jsTotalRaw: scripts.reduce((sum, item) => sum + item.bytes, 0),
    woff2Bytes: fonts.reduce((sum, item) => sum + item.bytes, 0),
    chunksBeforeLcp: before.map((item) => `${fileName(item.url)} ${item.gzip6}`),
    chunksAfterLcp: after.map((item) => `${fileName(item.url)} ${item.gzip6}`),
    fonts: fonts.map((item) => `${fileName(item.url)} ${item.bytes}`),
  };
}

test('the five main screens stay within the JS and font budgets when signed in (B performance)', async ({ browser, page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const storageState = await page.context().storageState();

  const results: ScreenResult[] = [];
  for (const [screen, path] of screens) {
    const context = await freshContext(browser, storageState);
    const fresh = await context.newPage();
    results.push(await measure(fresh, screen, path));
    await context.close();
  }

  // 1つの文脈で5画面を続けて開いたときに、書体を合わせていくつ読むか。
  const context = await freshContext(browser, storageState);
  const session = await context.newPage();
  const done = collect(session);
  for (const [, path] of screens) {
    await session.goto(path);
    await expect(session.locator('h1').first()).toBeVisible();
    await session.waitForLoadState('networkidle');
  }
  const all = await done();
  await context.close();
  const uniqueFonts = new Map(all.filter((item) => item.kind === 'font').map((item) => [item.url, item.bytes]));
  const cumulativeWoff2Bytes = [...uniqueFonts.values()].reduce((sum, bytes) => sum + bytes, 0);

  const report = {
    measuredAt: new Date().toISOString(),
    build: 'dist-http (vite preview, uncompressed; JS counted as gzip -6 of each body)',
    budgets: { jsBeforeLcpGzip6: JS_BUDGET, woff2Bytes: FONT_BUDGET },
    screens: results,
    cumulativeWoff2Bytes,
  };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/performance-budget.json', `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.FAMILY_HUB_WRITE_BUDGET === '1') await writeFile('docs/audits/performance-budget.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(results.map((item) => `${item.screen}: JS ${item.jsBeforeLcpGzip6} (total ${item.jsTotalGzip6}) woff2 ${item.woff2Bytes} LCP ${item.lcpMs}ms`).join('\n'), `\ncumulative woff2 ${cumulativeWoff2Bytes}`);

  for (const item of results) {
    expect.soft(item.jsBeforeLcpGzip6, `${item.screen}: JS before LCP (gzip -6)`).toBeLessThanOrEqual(JS_BUDGET);
    expect.soft(item.woff2Bytes, `${item.screen}: woff2 bytes`).toBeLessThanOrEqual(FONT_BUDGET);
  }
});
