import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { failOnCspViolation, signIn } from './support';

const LLM_DOUBLE = 'http://127.0.0.1:8798';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: png });
const setDouble = (request: APIRequestContext, mode: string) => request.post(`${LLM_DOUBLE}/__mode`, { data: { mode } });

const receiptDialog = async (page: Page) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: '領収書を読み取る' }).click();
  return page.getByRole('dialog', { name: '領収書を読み取る' });
};
const eventDialog = async (page: Page) => {
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'URL・チラシから読み取る' }).click();
  return page.getByRole('dialog', { name: 'URL・チラシから読み取る' });
};

/** サインインの回数の上限はメールアドレスごとなので、1回のサインインで続けて確かめる。 */
test('reading helpers work against the LLM double, and nothing saves until the user does', async ({ page, request }) => {
  test.setTimeout(120_000);
  const violations = failOnCspViolation(page);
  await setDouble(request, 'valid');
  await signIn(page);

  await test.step('a receipt fills the form and saves only on request', async () => {
    const dialog = await receiptDialog(page);
    await expect(dialog).toContainText('家庭内で読み取ります');
    await dialog.getByLabel('領収書の画像').setInputFiles(image('receipt.png'));
    await dialog.getByRole('button', { name: '読み取る', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'すぐに追加' });
    await expect(form.getByLabel('支出名')).toHaveValue('試験スーパー', { timeout: 15_000 });
    await expect(form.getByLabel('金額（円）')).toHaveValue('2480');
    await expect(form.getByLabel('費目')).toHaveValue('food');
    await expect(form).toContainText('確かめてから保存してください');
    await form.getByRole('button', { name: 'キャンセル' }).click();
    await page.goto('/budget?view=list');
    await expect(page.getByRole('link', { name: /試験スーパー/ })).toHaveCount(0);
  });

  await test.step('malformed output is refused and fills nothing', async () => {
    await setDouble(request, 'malformed');
    const dialog = await receiptDialog(page);
    await dialog.getByLabel('領収書の画像').setInputFiles(image('receipt.png'));
    await dialog.getByRole('button', { name: '読み取る', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('読み取れませんでした', { timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: 'すぐに追加' })).toHaveCount(0);
  });

  await test.step('output that fails validation is refused too', async () => {
    await setDouble(request, 'invalid');
    const dialog = await eventDialog(page);
    await dialog.getByLabel('ページのURL').fill('https://127.0.0.1/admin');
    await dialog.getByRole('button', { name: '読み取る', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('このURLは読み取れません');
    await dialog.getByRole('button', { name: 'チラシの画像' }).click();
    await dialog.getByLabel('チラシの画像').setInputFiles(image('flyer.png'));
    await dialog.getByRole('button', { name: '読み取る', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('読み取れませんでした', { timeout: 15_000 });
  });

  await test.step('a stalled reader gives up with a clear message', async () => {
    await setDouble(request, 'timeout');
    const dialog = await receiptDialog(page);
    await dialog.getByLabel('領収書の画像').setInputFiles(image('receipt.png'));
    await dialog.getByRole('button', { name: '読み取る', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('時間内に読み取れませんでした', { timeout: 15_000 });
  });

  await test.step('a flyer offers candidates, and a saved candidate reaches the calendar', async () => {
    await setDouble(request, 'valid');
    const dialog = await eventDialog(page);
    await dialog.getByRole('button', { name: 'チラシの画像' }).click();
    await dialog.getByLabel('チラシの画像').setInputFiles(image('flyer.png'));
    await dialog.getByRole('button', { name: '読み取る', exact: true }).click();
    await dialog.getByRole('button', { name: '「試験の区民まつり」を入力して開く' }).click({ timeout: 15_000 });
    const form = page.getByRole('dialog', { name: 'すぐに追加' });
    await expect(form.getByLabel('場所（任意）')).toHaveValue('中央公園');
    await form.getByRole('button', { name: '追加する' }).click();
    await expect(form).toBeHidden();
    await expect(page.locator('.toast-visible')).toContainText('予定を追加しました');
  });

  await test.step('a shift save that partly fails keeps the failed rows, and retrying saves them once', async () => {
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'シフトを読み取る' }).click();
    const dialog = page.getByRole('dialog', { name: 'シフトを読み取る' });
    await dialog.getByLabel('勤務表の文字').fill('2031/03/03 早番\n2031/03/04 遅番\n2031/03/05 休み');
    await dialog.getByRole('button', { name: /3件を保存/ }).waitFor();
    let posted = 0;
    const keys: string[] = [];
    await page.route('**/v1/events', async (route) => {
      posted += 1;
      keys.push(route.request().headers()['idempotency-key']);
      if (posted === 2) await route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ code: 'UPSTREAM_FAILURE', message: '保存に失敗しました', retryable: true }) });
      else await route.fallback();
    });
    await dialog.getByRole('button', { name: '3件を保存' }).click();
    await expect(dialog.getByRole('alert').first()).toContainText('保存に失敗しました');
    await expect(dialog.getByText('2件を保存しました。1件は保存できなかったので、表に残しています。')).toBeVisible();
    await expect(dialog.getByRole('table').getByRole('row')).toHaveCount(2);
    await expect(dialog.getByRole('row', { name: /遅番/ })).toBeVisible();
    await page.unroute('**/v1/events');
    await page.route('**/v1/events', async (route) => { keys.push(route.request().headers()['idempotency-key']); await route.fallback(); });
    await dialog.getByRole('button', { name: '1件を保存' }).click();
    await expect(dialog).toBeHidden();
    await page.unroute('**/v1/events');
    expect(keys[3]).toBe(keys[1]);
  });

  expect(violations).toEqual([]);
});

test('a child sees no reading helpers but can still read a shift', async ({ page }) => {
  await signIn(page, 'hana@example.test');
  await page.goto('/calendar');
  await expect(page.getByRole('button', { name: 'シフトを読み取る' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'URL・チラシから読み取る' })).toHaveCount(0);
});
