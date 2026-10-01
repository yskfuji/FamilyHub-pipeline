import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

const screens = [
  ['welcome','/welcome'],['auth','/auth'],['onboarding','/onboarding'],['today','/today'],['calendar','/calendar'],['tasks','/tasks'],['notes','/notes'],['budget','/budget'],['insights','/insights'],['settings-household','/settings/household'],['settings-security','/settings/security'],['settings-notifications','/settings/notifications'],['settings-accessibility','/settings/accessibility'],['settings-resources','/settings/resources'],['showcase','/showcase'],
  ['today-empty','/today?scenario=empty'],['today-offline','/today?scenario=offline'],['today-conflict','/today?scenario=conflict'],['today-expired-session','/today?scenario=expired-session'],['today-weather','/today?scenario=weather'],['notes-quarantined','/notes/memo-school?scenario=quarantined'],['showcase-expired-invite','/showcase?scenario=expired-invite'],
  ['today-child','/today?actor=member-hana'],['calendar-child','/calendar?actor=member-hana'],['today-guest','/today?actor=member-yui'],['resources-guest','/settings/resources?actor=member-yui'],['household-adult','/settings/household?actor=member-ren'],['household-forbidden-guest','/settings/household?actor=member-yui'],
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

for (const [viewport,width,height] of [['mobile',390,844],['desktop',1440,1000]] as const) {
  test(`${viewport} notification center`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 2');
    await page.setViewportSize({ width, height }); await page.goto('/today');
    await page.getByRole('button', { name: /通知を確認/ }).click();
    await expect(page.getByRole('heading', { name: '通知', exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/screens/${viewport}-notification-center-light.png`, fullPage: false, animations: 'disabled' });
  });
  test(`${viewport} event editor`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 2');
    await page.setViewportSize({ width, height }); await page.goto('/calendar/event-clean');
    await page.getByRole('button', { name: '編集する' }).click();
    await expect(page.getByRole('heading', { name: '予定を編集' })).toBeVisible();
    await page.screenshot({ path: `artifacts/screens/${viewport}-calendar-edit-light.png`, fullPage: false, animations: 'disabled' });
  });
  test(`${viewport} permission editor`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 2');
    await page.setViewportSize({ width, height }); await page.goto('/settings/household');
    await page.getByRole('button', { name: '権限' }).nth(1).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `artifacts/screens/${viewport}-settings-permission-light.png`, fullPage: false, animations: 'disabled' });
  });
  test(`${viewport} password editor`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'delivery capture uses fixed Chromium DPR 2');
    await page.setViewportSize({ width, height }); await page.goto('/settings/security');
    await page.getByRole('button', { name: 'パスワードを変更' }).click();
    await expect(page.getByRole('heading', { name: 'パスワードを変更' })).toBeVisible();
    await page.screenshot({ path: `artifacts/screens/${viewport}-settings-password-light.png`, fullPage: false, animations: 'disabled' });
  });
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
