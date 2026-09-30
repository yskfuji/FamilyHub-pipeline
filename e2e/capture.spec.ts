import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

const screens = [
  ['welcome','/welcome'],['auth','/auth'],['onboarding','/onboarding'],['today','/today'],['calendar','/calendar'],['tasks','/tasks'],['notes','/notes'],['budget','/budget'],['insights','/insights'],['settings-security','/settings/security'],['showcase','/showcase'],
  ['today-empty','/today?scenario=empty'],['today-offline','/today?scenario=offline'],['today-conflict','/today?scenario=conflict'],['today-expired-session','/today?scenario=expired-session'],['today-weather','/today?scenario=weather'],['notes-quarantined','/notes/memo-school?scenario=quarantined'],['showcase-expired-invite','/showcase?scenario=expired-invite'],
] as const;
const viewports = [
  ['mobile',390,844],['tablet',834,1112],['desktop',1440,1000],
] as const;

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

for (const [name,route] of [['today','/today'],['calendar','/calendar'],['tasks','/tasks'],['budget','/budget'],['showcase','/showcase']] as const) {
  test(`desktop ${name} dusk`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 1');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(route);
    await page.evaluate(() => { localStorage.setItem('family-hub-theme','dusk'); location.reload(); });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `artifacts/screens/desktop-${name}-dusk.png`, fullPage: true, animations: 'disabled' });
  });
}
