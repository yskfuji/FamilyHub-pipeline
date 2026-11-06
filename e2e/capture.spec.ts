import { mkdir } from 'node:fs/promises';
import { expect, test } from './fixtures';
import { openedStates, screens, viewports } from './screens';

// 画面の部品を差し替える試験がある。service worker が部品を取ると page.route を通らないので止める。
test.use({ deviceScaleFactor: 2, serviceWorkers: 'block' });

test.beforeAll(async () => { await mkdir('artifacts/screens', { recursive: true }); });

for (const [viewport,width,height] of viewports) {
  for (const [name,route] of screens) {
    test(`${viewport} ${name}`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 1');
      await page.setViewportSize({ width, height });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toBeVisible();
      await page.screenshot({ path: `artifacts/screens/${viewport}-${name}-light.png`, fullPage: true, animations: 'disabled' });
    });
  }
}

test('mobile calendar viewport positions', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 2');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  const positions = [
    ['initial', 0],
    ['middle', 0.5],
    ['end', 1],
  ] as const;
  for (const [name, ratio] of positions) {
    await page.evaluate((value) => window.scrollTo({ top: (document.documentElement.scrollHeight - window.innerHeight) * value, behavior: 'instant' }), ratio);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `artifacts/screens/mobile-calendar-viewport-${name}-light.png`, fullPage: false, animations: 'allow' });
  }
});

for (const [viewport,width,height] of viewports) {
  for (const state of openedStates.filter((item) => item.viewports.includes(viewport))) {
    test(`${viewport} ${state.name}`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 2');
      await page.setViewportSize({ width, height }); await page.goto(state.route);
      await state.open(page);
      // scrollIntoViewIfNeeded は滑らかに動く。止まる前に撮ると、枠ごとずれた絵になる（表を開いた図表の撮影で起きた）。
      await page.waitForFunction(() => new Promise<boolean>((resolve) => { let last = window.scrollY; let still = 0; const tick = () => { if (window.scrollY === last) still += 1; else { still = 0; last = window.scrollY; } if (still >= 5) resolve(true); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
      await page.screenshot({ path: `artifacts/screens/${viewport}-${state.name}-light.png`, fullPage: false, animations: 'disabled' });
    });
  }
}

for (const [name,route] of [['today','/today'],['calendar','/calendar'],['tasks','/tasks'],['budget','/budget'],['budget-settlements','/budget?view=settlements'],['insights','/insights'],['showcase','/showcase']] as const) {
  test(`desktop ${name} dusk`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 1');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(route);
    await page.evaluate(() => { localStorage.setItem('family-hub-theme','dusk'); location.reload(); });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `artifacts/screens/desktop-${name}-dusk.png`, fullPage: true, animations: 'disabled' });
  });
}
