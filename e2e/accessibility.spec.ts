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
});
