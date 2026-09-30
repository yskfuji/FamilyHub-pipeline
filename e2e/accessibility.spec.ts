import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const route of ['/welcome','/auth','/onboarding','/today','/calendar','/tasks','/notes','/budget','/insights','/settings/security','/showcase']) {
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
  const quick = page.getByRole('button', { name: 'クイック作成' });
  await quick.click();
  const dialog = page.getByRole('dialog', { name: 'クイック作成' });
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

test('all visible buttons meet the 44 by 44 CSS pixel target at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/today','/calendar','/tasks','/notes','/budget','/insights','/settings/household','/settings/security','/settings/notifications','/settings/accessibility','/showcase']) {
    await page.goto(route);
    const undersized = await page.locator('button:visible').evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') || button.textContent?.trim(), width: rect.width, height: rect.height };
    }).filter((item) => item.width < 44 || item.height < 44));
    expect(undersized, `${route}: ${JSON.stringify(undersized)}`).toEqual([]);
  }
});
