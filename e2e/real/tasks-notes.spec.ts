import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { failOnCspViolation, signIn } from './support';

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF\n') });
const attachments = '**/v1/memos/*/attachments';

/** 添付の送信を1回だけ失敗させる。responseLost のときは、API が受け取った後で応答だけを失う。 */
async function failOnce(page: Page, responseLost: boolean) {
  let failed = false;
  await page.route(attachments, async (route: Route) => {
    if (failed || route.request().method() !== 'POST') return route.continue();
    failed = true;
    if (responseLost) await route.fetch();
    return route.abort('connectionreset');
  });
}

async function createMemo(page: Page, title: string, fileName?: string) {
  await page.goto('/notes');
  await page.getByRole('button', { name: 'メモを追加' }).click();
  const form = page.getByRole('dialog', { name: 'メモを作る' });
  await form.getByLabel('タイトル').fill(title);
  await form.getByLabel('本文').fill('実スタックの本文');
  if (fileName) await form.getByLabel('一緒に添付するファイルを選択').setInputFiles(pdf(fileName));
  await form.getByRole('button', { name: '作成する' }).click();
  return page.getByRole('dialog', { name: title });
}

test('a memo attachment that failed is retried without a second memo, opens through the API, and can be deleted', async ({ page }) => {
  const violations = failOnCspViolation(page);
  await signIn(page);
  await failOnce(page, false);
  const drawer = await createMemo(page, '実スタックの添付', 'お知らせ.pdf');

  const retry = drawer.getByRole('button', { name: 'お知らせ.pdfをもう一度送る' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(drawer.getByRole('button', { name: 'お知らせ.pdfを削除' })).toBeVisible();
  await expect(retry).toHaveCount(0);

  const open = drawer.getByRole('button', { name: 'お知らせ.pdfを開く（新しいタブ）' });
  await expect(open).toBeVisible({ timeout: 10_000 });
  const served = page.context().waitForEvent('response', (response) => response.url().includes('/v1/attachment-files/'));
  await open.click();
  expect((await served).status()).toBe(200);

  await drawer.getByRole('button', { name: 'お知らせ.pdfを削除' }).click();
  await page.getByRole('dialog', { name: '添付ファイルを削除しますか' }).getByRole('button', { name: '削除する' }).click();
  await expect(page.locator('.toast-visible')).toContainText('削除しました');
  await expect(drawer.getByText('添付ファイルはありません。')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('dialog', { name: '実スタックの添付' }).getByText('添付ファイルはありません。')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('.memo-card h2').filter({ hasText: '実スタックの添付' })).toHaveCount(1);
  expect(violations).toEqual([]);
});

test('retrying after a lost response does not attach the file twice', async ({ page }) => {
  const violations = failOnCspViolation(page);
  await signIn(page);
  const drawer = await createMemo(page, '実スタックの応答切れ');
  await failOnce(page, true);
  await drawer.getByLabel('添付するファイルを選択').setInputFiles(pdf('応答切れ.pdf'));
  const retry = drawer.getByRole('button', { name: '応答切れ.pdfをもう一度送る' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('dialog', { name: '実スタックの応答切れ' }).locator('.attachment-row')).toHaveCount(1);
  expect(violations).toEqual([]);
});

test('a file the server refuses by its contents says so and offers no retry', async ({ page }) => {
  await signIn(page);
  const drawer = await createMemo(page, '実スタックの拒否');
  await drawer.getByLabel('添付するファイルを選択').setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<script>alert(1)</script>') });
  await expect(drawer.getByText(/この形式のファイルは受け付けていません/)).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'fake.pdfをもう一度送る' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'fake.pdfを取り除く' })).toBeVisible();
});

test('task status comments and the full task form work against the API under CSP', async ({ page }) => {
  const violations = failOnCspViolation(page);
  await signIn(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'タスクを追加' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await form.getByLabel('タスク名').fill('実スタックの一言');
  await form.getByLabel('開始（任意）').fill('2026-12-01T09:00');
  await form.getByLabel('期限（任意）').fill('2026-12-02T18:00');
  await form.getByLabel('優先度').selectOption('high');
  await form.getByLabel('公開範囲').selectOption('adults');
  await form.getByLabel('繰り返し', { exact: true }).selectOption('weekly');
  await form.getByRole('radio', { name: '家のこと' }).check();
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(page.locator('.toast-visible')).toContainText('タスクを追加しました');

  await page.getByRole('link', { name: /実スタックの一言/ }).click();
  let drawer = page.getByRole('dialog', { name: '実スタックの一言' });
  await drawer.getByLabel('一言（任意）').fill('鍵を預かりました');
  await drawer.getByRole('button', { name: '相手待ちにする' }).click();
  await expect(page.locator('.toast-visible')).toContainText('相手待ちにしました');

  await page.reload();
  await page.getByRole('link', { name: /実スタックの一言/ }).click();
  drawer = page.getByRole('dialog', { name: '実スタックの一言' });
  await expect(drawer.getByText('鍵を預かりました')).toBeVisible();
  await expect(drawer.getByText('優先度：高い')).toBeVisible();
  await drawer.getByRole('button', { name: '内容を編集' }).click();
  await page.getByRole('dialog', { name: 'タスクを編集' }).getByRole('button', { name: 'キャンセル' }).click();
  await drawer.getByLabel('一言（任意）').fill('返しました');
  await drawer.getByRole('button', { name: '完了にする' }).click();
  await expect(page.locator('.toast-visible')).toContainText('次の回を作成しました');

  await page.goto('/tasks?filter=done');
  await page.getByRole('link', { name: /実スタックの一言/ }).click();
  await expect(page.getByRole('dialog', { name: '実スタックの一言' }).getByText('返しました')).toBeVisible();
  await page.goto('/tasks');
  await expect(page.getByRole('link', { name: /実スタックの一言/ }).getByText(/12月8日/).first()).toBeVisible();
  expect(violations).toEqual([]);
});
