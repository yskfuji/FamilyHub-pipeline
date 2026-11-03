import { test as base, type Page } from '@playwright/test';

export * from '@playwright/test';

/**
 * 画面の本文は経路ごとに分けて後から読むので、page.goto の直後には骨組みしかないことがある。
 * 本文を描き終えると、アプリが html の data-route-ready に今のパスを書く（src/app/routeLoading.tsx）。
 * goto と reload のあとに、その印を待つ。試験ごとに待ちを足さずに、読み込みとの競争をなくすため。
 * アプリの外のパスなど印が出ないときは、待つのをやめて試験の確かめに任せる。
 */
export async function waitForRoute(page: Page, timeout = 10_000) {
  await page.waitForFunction(() => document.documentElement.dataset.routeReady === window.location.pathname, undefined, { timeout }).catch(() => undefined);
}

export const test = base.extend({
  // Playwright の fixture の use（React の use ではない）。
  page: async ({ page }, provide) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (url, options) => { const response = await goto(url, options); if (options?.waitUntil !== 'commit') await waitForRoute(page); return response; };
    page.reload = async (options) => { const response = await reload(options); await waitForRoute(page); return response; };
    await provide(page);
  },
});
