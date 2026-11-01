import { expect, test } from '@playwright/test';
import { failOnCspViolation, signIn } from './support';

test('the calendar form works against the API under CSP: all fields, clearing, scoped delete and undo', async ({ page }) => {
  const violations = failOnCspViolation(page);
  await signIn(page);
  await page.goto('/calendar');
  await page.getByRole('button', { name: '予定を追加', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await form.getByLabel('予定名').fill('実スタックの予定');
  await form.getByLabel('場所（任意）').fill('公民館');
  await form.getByLabel('終日').check();
  await form.getByLabel('公開範囲').selectOption('selected');
  await form.getByRole('group', { name: /公開するメンバー/ }).getByRole('checkbox').first().check();
  await form.getByLabel('繰り返し', { exact: true }).selectOption('daily');
  await form.getByLabel('通知').selectOption('60');
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(page.locator('.toast-visible')).toContainText('予定を追加しました');

  const panel = page.locator('.calendar-day-panel');
  await panel.getByRole('button', { name: '実スタックの予定を開く' }).click();
  const drawer = page.getByRole('dialog', { name: '実スタックの予定' });
  await expect(drawer.getByText('毎日')).toBeVisible();
  await expect(drawer.getByText('1時間前')).toBeVisible();

  await drawer.getByRole('button', { name: '編集する' }).click();
  await expect(page.getByRole('dialog', { name: '予定を編集' }).getByLabel('繰り返し', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'キャンセル' }).click();
  await drawer.getByLabel('対象とする予定').selectOption('series');
  await drawer.getByRole('button', { name: '編集する' }).click();
  const edit = page.getByRole('dialog', { name: '予定を編集' });
  await edit.getByLabel('場所（任意）').fill('');
  await edit.getByLabel('通知').selectOption('');
  await edit.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.locator('.toast-visible')).toContainText('更新しました');
  await expect(drawer.getByText('1時間前')).toHaveCount(0);
  await expect(drawer.getByRole('heading', { name: '場所' }).locator('xpath=following-sibling::p[1]')).toHaveText('未設定');

  await drawer.getByLabel('対象とする予定').selectOption('this');
  await drawer.getByRole('button', { name: '予定を削除' }).click();
  await page.getByRole('dialog', { name: '予定を削除しますか' }).getByRole('button', { name: '削除する' }).click();
  await expect(panel.getByRole('button', { name: '実スタックの予定を開く' })).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(panel.getByRole('button', { name: '実スタックの予定を開く' })).toBeVisible();

  await page.getByRole('button', { name: '週', exact: true }).click();
  await expect(page.locator('.timeline-ribbon').filter({ hasText: '実スタックの予定' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '週', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(violations).toEqual([]);
});
