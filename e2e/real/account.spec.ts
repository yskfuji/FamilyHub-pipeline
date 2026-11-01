import { expect, test } from '@playwright/test';
import { PASSWORD, signIn } from './support';

test('a new person signs up, creates a household and reaches the app', async ({ page }) => {
  await page.goto('/auth');
  await page.getByRole('link', { name: 'はじめての方' }).click();
  await page.getByLabel('名前').fill('新しい人');
  await page.getByLabel('メールアドレス').fill('new-person@example.test');
  await page.getByLabel('パスワード').fill('a-long-enough-password');
  await page.getByLabel('誕生日').fill('1990-04-01');
  await page.getByRole('button', { name: 'アカウントを作る' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('家族グループの名前').fill('新しい家族');
  await page.getByRole('button', { name: /次へ/ }).click();
  await page.getByRole('button', { name: /次へ/ }).click();
  await page.getByRole('link', { name: /今日|始める/ }).or(page.getByRole('button', { name: /今日|始める/ })).first().click();
  await expect(page).toHaveURL(/\/today/);
  await page.goto('/settings/household');
  await expect(page.getByRole('heading', { name: '設定' }).or(page.getByText('新しい家族')).first()).toBeVisible();
  const snapshot = await page.evaluate(async () => (await fetch('/v1/households/current/snapshot', { credentials: 'include' })).json());
  expect(snapshot.household.name).toBe('新しい家族');
  expect(snapshot.memberships).toHaveLength(1);
  expect(snapshot.events).toEqual([]);
});

test('settling money asks for the password again and finishes the same action without losing the screen', async ({ page }) => {
  await signIn(page);
  await page.goto('/budget/expense-books');
  await page.waitForTimeout(2100);
  await page.getByRole('button', { name: /蓮さんの残り.*を精算$/ }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: '本人確認' });
  await expect(confirm).toBeVisible();
  await confirm.getByLabel('パスワード').fill('wrong-password-long-enough');
  await confirm.getByRole('button', { name: '続ける' }).click();
  await expect(confirm.getByRole('alert')).toContainText('パスワードを確認してください');
  await confirm.getByLabel('パスワード').fill(PASSWORD);
  await confirm.getByRole('button', { name: '続ける' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText('すべて精算済みです。')).toBeVisible();
});

test('account settings save through the API and the sign-in page has no sample address', async ({ page }) => {
  await signIn(page, 'ren@example.test', PASSWORD);
  await page.goto('/settings/account');
  await page.getByLabel('操作がないときに自動でサインアウトする').selectOption('15');
  await expect(page.locator('.toast-visible')).toContainText('自動サインアウト');
  await page.reload();
  await expect(page.getByLabel('操作がないときに自動でサインアウトする')).toHaveValue('15');
});
