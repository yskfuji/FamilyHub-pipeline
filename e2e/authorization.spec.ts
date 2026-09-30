import { expect, test } from '@playwright/test';

test('owner sees administration with localized role and status labels', async ({ page }) => {
  await page.goto('/settings/household');
  await expect(page.getByText('管理者 · 利用中')).toBeVisible();
  await expect(page.getByRole('button', { name: /の権限を設定/ })).toHaveCount(5);
  await expect(page.getByRole('heading', { name: '家族を招待' })).toBeVisible();
  await expect(page.getByText(/owner · active/)).toBeHidden();
});

test('adult can view members but cannot administer them', async ({ page }) => {
  await page.goto('/settings/household?actor=member-ren');
  await expect(page.getByText('権限の変更と招待は管理者だけが行えます。')).toBeVisible();
  await expect(page.getByRole('button', { name: /の権限を設定/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '家族を招待' })).toBeHidden();
  await page.goto('/budget?actor=member-ren');
  await expect(page.getByRole('heading', { name: '家計と割り勘' })).toBeVisible();
});

test('child sees related content and direct forbidden routes explain recovery', async ({ page }) => {
  await page.goto('/calendar?actor=member-hana');
  await expect(page.getByText('花｜学校公開').first()).toBeVisible();
  await expect(page.getByText('空｜ピアノ')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '家計' })).toBeHidden();
  await page.goto('/budget?actor=member-hana');
  await expect(page.getByRole('heading', { name: 'このページは利用できません' })).toBeVisible();
  await expect(page.getByRole('link', { name: '今日の画面へ戻る' })).toBeVisible();
});

test('guest is read-only and sees only explicitly selected resources', async ({ page }) => {
  await page.goto('/today?actor=member-yui');
  await expect(page.getByRole('button', { name: 'クイック作成' })).toBeHidden();
  await expect(page.getByRole('link', { name: '家計' })).toBeHidden();
  await page.goto('/settings/resources?actor=member-yui');
  await expect(page.getByRole('heading', { name: '青葉小学校 保護者ページ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '世田谷区 子育て手続き' })).toHaveCount(0);
  await page.goto('/settings/household?actor=member-yui');
  await expect(page.getByRole('heading', { name: 'このページは利用できません' })).toBeVisible();
});

test('offline collaborative creation is queued, reviewed, and explicitly replayed', async ({ page }) => {
  await page.goto('/today?scenario=offline');
  await page.getByRole('button', { name: 'クイック作成' }).click();
  await page.getByRole('button', { name: '予定', exact: true }).click();
  await page.getByLabel('予定名').fill('再送する予定');
  await page.getByRole('button', { name: '追加する' }).click();
  await expect(page.getByRole('button', { name: /再送待ち/ })).toContainText('1');
  await page.getByRole('button', { name: /再送待ち/ }).click();
  await expect(page.getByRole('heading', { name: '再送待ち' })).toBeVisible();
  await expect(page.getByText('予定「再送する予定」を作成')).toBeVisible();
  await page.getByRole('button', { name: 'この変更を送信' }).click();
  await expect(page.getByText('予定「再送する予定」を作成')).toBeHidden();
});

test('every visible interactive control has a stable registry id and accessible name', async ({ page }) => {
  for (const route of ['/welcome','/auth','/onboarding','/today','/calendar','/tasks','/notes','/budget','/insights','/settings/household','/settings/security','/settings/notifications','/settings/accessibility','/settings/resources']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const failures = await page.locator('button:visible, a[href]:visible, input:visible, select:visible, textarea:visible').evaluateAll((elements) => elements.map((element) => ({
      tag: element.tagName, id: (element as HTMLElement).dataset.controlId, name: element.getAttribute('aria-label') || element.textContent?.trim() || (element as HTMLInputElement).labels?.[0]?.textContent?.trim(),
    })).filter((item) => !item.id || !item.name));
    expect(failures, `${route}: ${JSON.stringify(failures)}`).toEqual([]);
    const ids = await page.locator('button:visible, a[href]:visible, input:visible, select:visible, textarea:visible').evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.controlId));
    expect(new Set(ids).size, `${route}: duplicate control registry id`).toBe(ids.length);
  }
});
