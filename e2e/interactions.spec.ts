import { expect, test } from '@playwright/test';

test('notification bell opens an operable notification center', async ({ page }) => {
  await page.goto('/today');
  const bell = page.getByRole('button', { name: /通知を確認/ });
  await expect(bell).toHaveAccessibleName(/未読1件/);
  await bell.click();
  await expect(page.getByRole('heading', { name: '通知センター' })).toBeVisible();
  await page.getByRole('button', { name: '30分延期' }).click();
  await expect(page.locator('.toast-visible')).toContainText('30分延期');
  await expect(page.getByText('延期済み')).toBeVisible();
  await page.getByRole('button', { name: 'この通知を停止' }).click();
  await expect(page.getByText('停止済み')).toBeVisible();
});

test('calendar week/list, edit, cancel delete, and confirmed delete work', async ({ page }) => {
  await page.goto('/calendar');
  await page.getByRole('button', { name: '週', exact: true }).click();
  await expect(page.getByLabel('9月28日から10月4日の予定')).toBeVisible();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await expect(page.getByRole('button', { name: '詳細' }).first()).toBeVisible();
  await page.goto('/calendar/event-school');
  await page.getByRole('button', { name: '編集する' }).click();
  await page.getByLabel('予定名').fill('花｜学校公開（更新）');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
  await page.getByRole('button', { name: '予定を削除' }).click();
  await expect(page.getByRole('heading', { name: '予定を削除しますか' })).toBeVisible();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByRole('heading', { name: '花｜学校公開（更新）' })).toBeVisible();
  await page.getByRole('button', { name: '予定を削除' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.locator('.toast-visible')).toContainText('削除しました');
});

test('Todo edit and memo creation update state and URLs', async ({ page }) => {
  await page.goto('/tasks/todo-form');
  await page.getByRole('button', { name: '内容を編集' }).click();
  await page.getByLabel('すること').fill('就学援助の確認票（更新）');
  await page.getByLabel('担当者').selectOption('member-ren');
  await page.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
  await expect(page.getByRole('heading', { name: '就学援助の確認票（更新）' })).toBeVisible();
  await page.goto('/notes');
  await page.getByRole('button', { name: 'メモを作る' }).click();
  await page.getByLabel('タイトル').fill('新しい家族メモ');
  await page.getByLabel('本文').fill('忘れないように共有する内容です。');
  await page.getByLabel('タグ').fill('共有、今週');
  await page.getByRole('button', { name: '作成する' }).click();
  await expect(page).toHaveURL(/\/notes\/memo-mock-/);
  await expect(page.getByRole('dialog', { name: '新しい家族メモ' }).getByRole('heading', { name: '新しい家族メモ' })).toBeVisible();
});

test('all household permission controls, sole-owner guard, and invite creation work', async ({ page }) => {
  await page.goto('/settings/household');
  const permissionButtons = page.getByRole('button', { name: '権限' });
  await expect(permissionButtons).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await permissionButtons.nth(index).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'キャンセル' }).click();
  }
  await permissionButtons.first().click();
  await page.getByRole('dialog').getByLabel('役割').selectOption('adult');
  await page.getByRole('button', { name: '権限を保存' }).click();
  await expect(page.getByRole('alert')).toContainText('少なくとも1人');
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await permissionButtons.nth(1).click();
  await page.getByRole('dialog').getByLabel('役割').selectOption('guest');
  await page.getByRole('button', { name: '権限を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('guest');
  await page.locator('#invite-role').selectOption('guest');
  await page.getByRole('button', { name: /1回限りの招待/ }).click();
  await expect(page.getByText('今回だけ表示する招待コード')).toBeVisible();
  await expect(page.locator('.invite-result code')).toContainText('FAMILY-2026');
});

test('passkey, password, and individual session controls work with confirmation', async ({ page }) => {
  await page.goto('/settings/security');
  await page.getByRole('button', { name: '別のパスキーを追加' }).click();
  await expect(page.locator('.toast-visible')).toContainText('デモ用パスキー');
  await expect(page.getByText('この端末（デモ）')).toBeVisible();
  await page.getByRole('button', { name: 'パスワードを変更' }).click();
  await page.getByLabel('現在のパスワード').fill('current-password-long-enough');
  await page.getByLabel('新しいパスワード', { exact: true }).fill('new-family-password-2026');
  await page.getByLabel('新しいパスワード（確認）').fill('new-family-password-2026');
  await page.getByRole('button', { name: '変更する' }).click();
  await expect(page.locator('.toast-visible')).toContainText('入力内容は破棄');
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByText('iPhone Safari')).toBeVisible();
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await page.getByRole('button', { name: 'セッションを終了' }).click();
  await expect(page.getByText('iPhone Safari')).toBeHidden();
});

test('three notification preferences and preview actions persist', async ({ page }) => {
  await page.goto('/settings/notifications');
  for (const label of ['Todo期限の通知', '出発時刻の通知', '夜間停止']) {
    const toggle = page.getByRole('button', { name: label });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  }
  await page.getByRole('button', { name: '30分延期' }).click();
  await expect(page.locator('.toast-visible')).toContainText('30分延期');
  await page.getByRole('button', { name: 'この通知を停止' }).click();
  await expect(page.getByText('停止済み')).toBeVisible();
});

test('onboarding privacy draft toggles and saves creator-only default', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /次へ/ }).click();
  const household = page.getByRole('button', { name: '世帯メンバーのみに共有' });
  const preview = page.getByRole('button', { name: '通知内容を伏せる' });
  await household.click(); await preview.click();
  await expect(household).toHaveAttribute('aria-pressed', 'false');
  await expect(preview).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /次へ/ }).click();
  await expect(page.getByRole('heading', { name: /ようこそ/ })).toBeVisible();
  await expect(page.locator('.toast-visible')).toContainText('作成者のみ');
});

test('all resource links use HTTPS, noreferrer and an opener-free new tab', async ({ page, context }) => {
  await context.route('https://example.com/**', async (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>example</title>' }));
  await page.goto('/settings/resources');
  const links = page.getByRole('link', { name: /安全な新しいタブで開く/ });
  await expect(links).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const link = links.nth(index);
    await expect(link).toHaveAttribute('href', /^https:\/\/example\.com\//);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await popup.close();
  }
});
