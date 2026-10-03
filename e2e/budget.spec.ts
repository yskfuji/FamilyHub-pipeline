import { expect, test } from '@playwright/test';

// 円記号はブラウザの Intl 実装で全角（Chromium）と半角（WebKit）が異なるため、どちらも受け付ける。
const yen = (amount: string) => `[¥￥]${amount.replace(',', '\\,')}`;

test('metrics, categories and who-owes-whom are computed from records', async ({ page }) => {
  await page.goto('/budget');
  await expect(page.getByText('2026年9月の支出3件の合計')).toBeVisible();
  await expect(page.locator('.metric').first()).toHaveText(new RegExp(`^${yen('12,060')}$`));
  const categories = page.locator('.category-list li');
  await expect(categories).toHaveCount(3);
  await expect(categories.nth(0)).toContainText('食費');
  await expect(categories.nth(0)).toContainText('（48%）');
  await expect(page.getByText('碧さんから蓮さんへ')).toBeVisible();
  await expect(page.getByRole('heading', { name: '誰にいくら支払うか' }).locator('..').locator('..')).toContainText(new RegExp(yen('250')));
});

test('expense detail shows place, shares and history; settling and reversing keep both records', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('link', { name: '学校教材' }).click();
  await expect(page).toHaveURL(/\/budget\/expense-books$/);
  const drawer = page.getByRole('dialog', { name: '学校教材' });
  await expect(drawer.getByText('青葉書店', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'この場所の記録を見る' })).toHaveAttribute('href', /\/places\/[0-9a-f]{8}$/);
  await expect(drawer.getByRole('table')).toContainText('蓮');
  await expect(drawer.getByText('精算の記録はまだありません。')).toBeVisible();

  await drawer.getByRole('button', { name: new RegExp(`^蓮さんの残り${yen('1,430')}を精算$`) }).click();
  await expect(drawer.getByText('蓮さんから碧さんへ')).toBeVisible();
  await expect(drawer.getByText('すべて精算済みです。')).toBeVisible();
  await expect(page.getByRole('button', { name: '精算を取り消す', exact: true })).toBeVisible();

  await drawer.getByRole('button', { name: new RegExp(`の${yen('1,430')}の精算を取り消す$`) }).click();
  await expect(drawer.getByText('取り消し済み')).toBeVisible();
  await expect(drawer.getByText(/^取り消し（蓮さんの精算）$/)).toBeVisible();
  await expect(drawer.getByRole('button', { name: new RegExp(`^蓮さんの残り${yen('1,430')}を精算$`) })).toBeVisible();

  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page).toHaveURL(/\/budget$/);
  const history = page.getByRole('heading', { name: '精算の履歴' }).locator('xpath=ancestor::section[1]');
  await expect(history.getByText('取り消し済み')).toBeVisible();
  await page.getByRole('button', { name: '精算の履歴を見る' }).click();
  await expect(page.getByRole('heading', { name: '精算の履歴' })).toBeFocused();
});

test('editing locks the split after a settlement, and deletion is blocked until it is reversed', async ({ page }) => {
  await page.goto('/budget/expense-groceries');
  const drawer = page.getByRole('dialog', { name: '週末の食材' });
  await expect(drawer.getByRole('button', { name: '支出を削除' })).toBeDisabled();
  await expect(drawer.getByText('精算の記録があるため削除できません。')).toBeVisible();
  await drawer.getByRole('button', { name: '内容を編集' }).click();
  const edit = page.getByRole('dialog', { name: '支出を編集' });
  await expect(edit.getByLabel('金額（円）')).toBeDisabled();
  await edit.getByLabel('支出名').fill('週末の食材（まとめ買い）');
  await edit.getByLabel('費目').selectOption('home');
  await edit.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('dialog', { name: '週末の食材（まとめ買い）' })).toContainText('住まい・日用品');
});

test('an expense without settlements can be deleted and restored', async ({ page }) => {
  await page.goto('/budget/expense-train');
  await page.getByRole('dialog', { name: '家族のおでかけ交通費' }).getByRole('button', { name: '支出を削除' }).click();
  await page.getByRole('dialog', { name: '支出を削除しますか' }).getByRole('button', { name: '削除する' }).click();
  await expect(page).toHaveURL(/\/budget$/);
  await expect(page.getByRole('link', { name: '家族のおでかけ交通費' })).toHaveCount(0);
  await expect(page.locator('.callout').getByText('「家族のおでかけ交通費」を削除しました')).toBeVisible();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByRole('link', { name: '家族のおでかけ交通費' })).toBeVisible();
});

test('unknown expense links explain instead of silently showing the list', async ({ page }) => {
  await page.goto('/budget/expense-unknown');
  await expect(page.getByText('支出が見つからないか、表示する権限がありません')).toBeVisible();
});

test('insights follow the ledger after settling', async ({ page }) => {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { name: new RegExp(`^未精算は合計${yen('3,110')}$`) })).toBeVisible();
  await page.goto('/budget/expense-books');
  await page.getByRole('dialog', { name: '学校教材' }).getByRole('button', { name: new RegExp(`^蓮さんの残り${yen('1,430')}を精算$`) }).click();
  await expect(page.locator('.toast-visible')).toContainText('精算を記録');
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('link', { name: 'ヒント' }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(`^未精算は合計${yen('1,680')}$`) })).toBeVisible();
});
