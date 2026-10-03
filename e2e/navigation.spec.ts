import { expect, test } from '@playwright/test';

test('the mobile "more" menu is a dialog: focus, Escape, current page and closing on navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/today');
  const more = page.getByRole('button', { name: 'その他', exact: true });
  await more.click();
  const dialog = page.getByRole('dialog', { name: 'その他' });
  await expect(dialog.getByRole('link', { name: '家計' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: '場所' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await dialog.getByRole('link', { name: '家計' }).click();
  await expect(page).toHaveURL(/\/budget$/);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'その他（表示中：家計）' })).toBeVisible();
});

test('unknown paths and loose prefixes show the not-found page', async ({ page }) => {
  await page.goto('/todayfoo');
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
  await page.goto('/settings/unknown');
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
});

test('bare /settings opens the first allowed tab and never the household tab for children', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings\/household$/);
  await page.goto('/settings?actor=member-hana');
  await expect(page).toHaveURL(/\/settings\/security/);
  await page.goto('/settings/household?actor=member-hana');
  await expect(page.getByRole('heading', { name: 'このページは表示できません' })).toBeVisible();
  await page.goto('/settings/notifications?actor=member-yui');
  await expect(page.getByRole('link', { name: '共有とプライバシー' })).toBeVisible();
});

test('unknown detail ids explain the situation', async ({ page }) => {
  await page.goto('/tasks/todo-unknown');
  await expect(page.getByText('タスクが見つからないか、表示する権限がありません')).toBeVisible();
  await page.goto('/places/00000000');
  await expect(page.getByText('場所が見つからないか、表示する権限がありません')).toBeVisible();
});

test('search finds expenses, places and memo text, and opens the detail', async ({ page }) => {
  await page.goto('/today');
  await page.getByRole('button', { name: /検索/ }).click();
  await page.getByRole('searchbox').fill('青葉書店');
  await expect(page.getByRole('link', { name: '場所「青葉書店」を開く' })).toBeVisible();
  await page.getByRole('link', { name: '支出「学校教材」を開く' }).click();
  await expect(page).toHaveURL(/\/budget\/expense-books$/);
  await expect(page.getByRole('dialog', { name: '学校教材' })).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('button', { name: /検索/ }).click();
  await page.getByRole('searchbox').fill('連絡ルール');
  await page.getByRole('link', { name: '関連リンク「家族の連絡ルール」を開く' }).click();
  await expect(page).toHaveURL(/\/settings\/resources#resource-guide$/);
  await expect(page.locator('#resource-guide')).toHaveClass(/is-target/);
});

test('deleting a memo shows the restore option even after the data refreshes', async ({ page }) => {
  await page.goto('/notes/memo-clinic');
  await page.getByRole('button', { name: 'メモを削除' }).click();
  await page.getByRole('dialog', { name: 'メモを削除しますか' }).getByRole('button', { name: '削除する' }).click();
  await expect(page.getByText('「小児科の控え」を削除しました')).toBeVisible();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByRole('heading', { name: '小児科の控え' })).toBeVisible();
});

test('privacy settings change sharing defaults and notification content; sign-out returns to the start', async ({ page }) => {
  await page.goto('/settings/privacy');
  await page.getByLabel('作成した本人だけ').check();
  await expect(page.locator('.toast-visible')).toContainText('作成した本人だけ');
  const hide = page.getByRole('button', { name: '通知の題名と内容を表示しない' });
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await hide.click();
  await expect(hide).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: /通知を確認/ }).click();
  await expect(page.getByRole('heading', { name: '図書館の本を返す' })).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.goto('/settings/security');
  await page.getByRole('button', { name: 'この端末からサインアウト' }).click();
  await page.getByRole('dialog', { name: 'この端末からサインアウトしますか' }).getByRole('button', { name: 'サインアウト' }).click();
  await expect(page).toHaveURL(/\/welcome$/);
});

test('places list is sorted by recent use and links to its records; children cannot open it', async ({ page }) => {
  await page.goto('/places');
  const cards = page.locator('.place-card');
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole('button', { name: '最近使った順' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '支出が多い順' }).click();
  await expect(cards.first()).toContainText('青葉書店');
  await cards.first().click();
  const drawer = page.getByRole('dialog', { name: '青葉書店' });
  await drawer.getByRole('link', { name: '学校教材' }).click();
  await expect(page).toHaveURL(/\/budget\/expense-books$/);
  await page.goto('/places?actor=member-hana');
  await expect(page.getByRole('heading', { name: 'このページは表示できません' })).toBeVisible();
});
