import { expect, test } from '@playwright/test';

test('registration and onboarding reach Today', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('link', { name: /はじめる/ }).click();
  await page.getByRole('button', { name: /パスキーで続ける/ }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole('button', { name: /次へ/ }).click();
  await page.getByRole('button', { name: /次へ/ }).click();
  await page.getByRole('button', { name: /Todayを開く/ }).click();
  await expect(page.getByRole('heading', { name: /おはよう/ })).toBeVisible();
});

test('household invite join and expiry are distinguishable', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: '招待で参加' }).click();
  const code = page.getByLabel('招待コード');
  await code.fill('EXPIRED');
  await page.getByRole('button', { name: /次へ/ }).click();
  await expect(page.getByRole('alert')).toContainText('有効期限');
  await code.fill('FAMILY-2026-VALID-CODE');
  await page.getByRole('button', { name: /次へ/ }).click();
  await expect(page.getByRole('heading', { name: 'プライバシー' })).toBeVisible();
});

test('calendar exposes recurring edit scope', async ({ page }) => {
  await page.goto('/calendar/event-piano');
  await expect(page.getByRole('heading', { name: '空｜ピアノ' })).toBeVisible();
  await expect(page.getByLabel('編集対象')).toContainText('今回のみ');
  await expect(page.getByLabel('編集対象')).toContainText('今回以降');
  await expect(page.getByLabel('編集対象')).toContainText('系列全体');
});

test('Todo reviewer and state update are visible', async ({ page }) => {
  await page.goto('/tasks/todo-form');
  await expect(page.getByText('レビュアー')).toBeVisible();
  await expect(page.getByText('蓮', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完了にする' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
});

test('memo attachment has quarantine and OCR caveat', async ({ page }) => {
  await page.goto('/notes/memo-receipt');
  await expect(page.getByText('隔離中')).toBeVisible();
  await expect(page.getByText('要原本確認')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '追加' }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({ name: 'notice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF mock') });
  await expect(page.locator('.toast-visible')).toContainText('隔離領域');
});

test('expense settlement changes the row', async ({ page }) => {
  await page.goto('/budget');
  const button = page.getByRole('button', { name: /残り.*を精算/ }).first();
  await button.click();
  await expect(page.locator('.toast-visible')).toContainText('精算を記録');
});

test('resource links and global search are reachable', async ({ page }) => {
  await page.goto('/settings/resources');
  await expect(page.getByRole('heading', { name: '青葉小学校 保護者ページ' })).toBeVisible();
  await page.getByRole('button', { name: /検索/ }).click();
  await page.getByRole('searchbox').fill('学校');
  await expect(page.getByRole('link', { name: '予定 花｜学校公開' })).toBeVisible();
});

test('offline state retains cached data and has recovery', async ({ page }) => {
  await page.goto('/today?scenario=offline');
  await expect(page.getByRole('alert')).toContainText('ネットワーク');
  await expect(page.getByRole('button', { name: '再試行' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日の流れ' })).toBeVisible();
});

test('conflict preserves the last view and offers recovery', async ({ page }) => {
  await page.goto('/today?scenario=conflict');
  await expect(page.getByRole('alert')).toContainText('別の端末');
  await expect(page.getByRole('button', { name: '再試行' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日の流れ' })).toBeVisible();
});

test('expired session hides household content until sign-in', async ({ page }) => {
  await page.goto('/today?scenario=expired-session');
  await expect(page.getByRole('alert')).toContainText('セッション');
  await expect(page.getByRole('heading', { name: '本人確認が必要です' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日の流れ' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'サインインへ' })).toBeVisible();
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/today','/calendar','/tasks','/notes','/budget','/insights','/settings/security','/showcase']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const metrics = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth, main: (() => { const el = document.querySelector('main'); return el ? el.scrollWidth - el.clientWidth : 0; })() }));
      expect(metrics, `${route}: ${JSON.stringify(metrics)}`).toEqual({ document: 0, body: 0, main: 0 });
    }
  });
}
