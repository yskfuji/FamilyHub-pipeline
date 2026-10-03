import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of ['/welcome','/auth','/onboarding','/today','/calendar','/calendar/event-clean','/tasks','/tasks/todo-form','/notes','/notes/memo-school','/budget','/budget/expense-books','/places','/places/00000000','/insights','/settings/household','/settings/security','/settings/privacy','/settings/notifications','/settings/accessibility','/settings/resources','/settings/location','/showcase','/todayx','/budget?actor=member-hana']) {
  test(`axe serious and critical: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    const blocking = results.violations.filter((violation) => ['serious','critical'].includes(violation.impact ?? ''));
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}

test('keyboard reaches navigation, search, and quick create', async ({ page, browserName }) => {
  await page.goto('/today');
  if (browserName === 'webkit') await page.getByRole('link', { name: '本文へ移動' }).focus();
  else await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '本文へ移動' })).toBeFocused();
  await page.getByRole('button', { name: /検索/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox')).toBeHidden();
  await expect(page.getByRole('button', { name: /検索/ })).toBeFocused();
});

test('keyboard shortcut, modal trap, Escape, inert background, and focus restoration work', async ({ page }) => {
  await page.goto('/today');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /検索/ })).toBeFocused();
  const quick = page.getByRole('button', { name: 'すぐに追加' });
  await quick.click();
  const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
  const close = dialog.getByRole('button', { name: '閉じる' });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '追加する' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(quick).toBeFocused();
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
});

test('manual Reduced Motion switch removes effective transitions', async ({ page }) => {
  await page.goto('/settings/accessibility');
  const sample = page.getByRole('button', { name: /検索/ });
  const before = await sample.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(before).not.toBe('0s');
  await page.getByRole('button', { name: '動きを減らす' }).click();
  const after = await sample.evaluate((element) => getComputedStyle(element).transitionDuration);
  const longest = Math.max(...after.split(',').map((value) => Number.parseFloat(value)));
  expect(longest).toBeLessThanOrEqual(0.001);
});

test('all visible buttons and button-like links meet the 44 by 44 CSS pixel target at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/welcome','/auth','/onboarding','/today','/calendar','/calendar/event-clean','/tasks','/notes','/notes/memo-school','/budget','/budget/expense-books','/places','/insights','/settings/household','/settings/security','/settings/privacy','/settings/notifications','/settings/accessibility','/settings/resources','/settings/location','/showcase']) {
    await page.goto(route);
    // 文中のリンク（WCAG 2.5.8 の例外）以外の、ボタンとして振る舞うリンクも測る。
    const undersized = await page.locator('button:visible, a.button:visible, .mobile-nav a:visible, a.nav-link:visible, a.place-card:visible, a.task-card:visible').evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') || button.textContent?.trim(), width: rect.width, height: rect.height };
    }).filter((item) => item.width < 44 || item.height < 44));
    expect(undersized, `${route}: ${JSON.stringify(undersized)}`).toEqual([]);
  }
});

test.describe('place picker', () => {
  test.use({ serviceWorkers: 'block' });
  test('with results passes axe and keeps 44px targets at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().route('https://api.openpoiapi.com/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 2, scope: 'view', suggestions: [
    { name: 'みどり文具店', address: '架空県みどり市こもれび町1-1', category: 'retail_other', lat: 35.6438, lng: 139.6692, source: 'overture', licenses: ['CDLA-Permissive-2.0'], attributions: ['Overture Maps Foundation, overturemaps.org'] },
    { name: 'とても長い名前のこもれびベーカリー　みどり市こもれび町本店（架空）', address: '架空県みどり市こもれび町二丁目三番地四号　こもれびビル一階', category: 'bakery', lat: 35.6441, lng: 139.6693, source: 'jff', licenses: ['CC BY 4.0'], attributions: ['架空県食品衛生営業許可施設'] },
  ], licenses: [], attributions: [] }) }));
  await page.goto('/budget');
  await page.getByRole('button', { name: '支出を追加' }).click();
  const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
  await dialog.getByRole('button', { name: '場所を追加（任意）' }).click();
  await dialog.getByRole('button', { name: '名前で探す', exact: true }).click();
  await dialog.getByLabel('お店や場所の名前').fill('文具');
  await dialog.getByRole('button', { name: '検索' }).click();
  await dialog.getByRole('button', { name: '同意して続ける' }).click();
  await expect(dialog.locator('.place-candidates button')).toHaveCount(2);
  const results = await new AxeBuilder({ page }).include('.dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  const blocking = results.violations.filter((violation) => ['serious','critical'].includes(violation.impact ?? ''));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  const undersized = await dialog.locator('button:visible').evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { label: button.getAttribute('aria-label') || button.textContent?.trim(), width: rect.width, height: rect.height };
  }).filter((item) => item.width < 44 || item.height < 44));
  expect(undersized).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
});
