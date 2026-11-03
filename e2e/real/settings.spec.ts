import { expect, test, type Browser, type Page } from '@playwright/test';
import { failOnCspViolation, PASSWORD, signIn } from './support';

const NEW_PASSWORD = 'a-long-enough-password';

/** 本人確認を求められたらパスワードを入れる。直前に確認していれば求められない。 */
async function passReauth(page: Page) {
  const prompt = page.getByRole('dialog').filter({ hasText: '本人確認' });
  try { await prompt.waitFor({ timeout: 1500 }); } catch { return; }
  await prompt.getByLabel('パスワード').fill(NEW_PASSWORD);
  await prompt.getByRole('button', { name: '続ける' }).click();
  await expect(prompt).toHaveCount(0);
}

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/sign-up');
  await page.getByLabel('名前').fill(name);
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(NEW_PASSWORD);
  await page.getByLabel('誕生日').fill('1990-04-01');
  await page.getByRole('button', { name: 'アカウントを作る' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

async function finishOnboarding(page: Page) {
  await page.getByRole('button', { name: /次へ/ }).click();
  await page.getByRole('button', { name: /次へ/ }).click();
  await page.getByRole('link', { name: /今日|始める/ }).or(page.getByRole('button', { name: /今日|始める/ })).first().click();
  await expect(page).toHaveURL(/\/today/);
}

async function createFamily(page: Page, name: string, email: string, family: string) {
  await signUp(page, name, email);
  await page.getByLabel('家族グループの名前').fill(family);
  await finishOnboarding(page);
}

async function invite(page: Page) {
  await page.goto('/settings/household');
  await page.getByRole('button', { name: '招待コードを作成' }).click();
  const code = await page.locator('.invite-result code').textContent();
  expect(code).toBeTruthy();
  return code!;
}

async function join(browser: Browser, code: string, name: string, email: string) {
  const context = await browser.newContext({ baseURL: 'http://localhost:4174', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  await signUp(page, name, email);
  await page.getByRole('button', { name: '招待コードで参加' }).click();
  await page.getByLabel('招待コード').fill(code);
  await finishOnboarding(page);
  return page;
}

test('the family tab governs members through the API', async ({ page, browser }) => {
  const violations = failOnCspViolation(page);
  await createFamily(page, '管理する人', 'owner-settings@example.test', '統治の家族');

  await page.goto('/settings/household');
  await expect(page.getByText(/あと2回変更できます|あと3回変更できます/)).toBeVisible();
  const before = await page.getByText(/回変更できます/).textContent();
  await page.getByLabel('名前', { exact: true }).fill('統治の家族二');
  await page.getByRole('button', { name: '名前を保存' }).click();
  await expect(page.getByText(/回変更できます/)).not.toHaveText(before!);

  const joiner = await join(browser, await invite(page), '大人の人', 'adult-settings@example.test');
  await page.reload();
  await expect(page.getByText(/利用中 2人 \/ 8人まで/)).toBeVisible();

  await page.getByRole('button', { name: '大人の人さんの権限を設定' }).click();
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.getByRole('button', { name: '一時停止する' }).click();
  await passReauth(page);
  await expect(page.locator('.toast-visible')).toContainText('一時停止しました');
  await joiner.reload();
  await expect(joiner.getByText('参加が一時停止されています')).toBeVisible();

  await page.getByRole('button', { name: '大人の人さんの権限を設定' }).click();
  await page.getByRole('button', { name: '一時停止を解除' }).click();
  await page.getByRole('button', { name: '解除する' }).click();
  await passReauth(page);
  await expect(page.locator('.toast-visible')).toContainText('一時停止を解除しました');
  await joiner.goto('/today');
  await expect(joiner.getByRole('heading', { name: /大人の人さん/ })).toBeVisible();

  await page.getByRole('button', { name: '大人の人さんの権限を設定' }).click();
  await page.getByRole('button', { name: '管理者を渡す' }).click();
  await page.getByRole('dialog', { name: '大人の人さんに管理者を渡しますか' }).getByRole('button', { name: '管理者を渡す' }).click();
  await passReauth(page);
  await expect(page.locator('.toast-visible')).toContainText('管理者を渡しました');
  await expect(page.getByRole('button', { name: '家族グループから退出' })).toBeVisible();

  await joiner.goto('/settings/household');
  await joiner.getByRole('button', { name: '管理する人さんの権限を設定' }).click();
  await joiner.getByRole('button', { name: '家族グループから外す' }).click();
  await joiner.getByRole('button', { name: '外す', exact: true }).click();
  await passReauth(joiner);
  await expect(joiner.locator('.toast-visible')).toContainText('家族グループから外しました');
  await expect(joiner.getByRole('button', { name: '管理する人さんの権限を設定' })).toHaveCount(0);
  await page.goto('/today');
  await expect(page).toHaveURL(/\/onboarding/);
  expect(violations).toEqual([]);
  await joiner.context().close();
});

test('a member who is not the owner can leave', async ({ page, browser }) => {
  await createFamily(page, '残る人', 'stay-settings@example.test', '退出の家族');
  const leaver = await join(browser, await invite(page), '抜ける人', 'leave-settings@example.test');
  await leaver.goto('/settings/account');
  await leaver.getByRole('button', { name: '家族グループから退出' }).click();
  await leaver.getByRole('button', { name: '退出する' }).click();
  await passReauth(leaver);
  await expect(leaver).toHaveURL(/\/onboarding/);
  await page.reload();
  await expect(page.getByText(/利用中 1人 \/ 8人まで/)).toBeVisible();
  await leaver.context().close();
});

test('recently deleted restores a record through the API, and color lists are saved', async ({ page }) => {
  await createFamily(page, '戻す人', 'restore-settings@example.test', '戻す家族');
  await page.goto('/notes');
  await page.getByRole('button', { name: 'メモを追加' }).click();
  const form = page.getByRole('dialog', { name: 'メモを作る' });
  await form.getByLabel('タイトル').fill('消して戻すメモ');
  await form.getByLabel('本文').fill('本文');
  await form.getByRole('button', { name: '作成する' }).click();
  await page.getByRole('button', { name: 'メモを削除' }).click();
  await page.getByRole('dialog', { name: 'メモを削除しますか' }).getByRole('button', { name: '削除' }).click();
  await expect(page.locator('.toast-visible')).toContainText('削除しました');

  await page.goto('/settings/recently-deleted');
  const row = page.getByRole('listitem').filter({ hasText: '消して戻すメモ' });
  await expect(row).toContainText('あと7日');
  await row.getByRole('button', { name: '「消して戻すメモ」を元に戻す' }).click();
  await expect(page.getByText('最近削除したものはありません')).toBeVisible();
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: '消して戻すメモ' })).toBeVisible();

  await page.goto('/settings/household');
  await page.getByRole('button', { name: 'リストを追加' }).click();
  const list = page.getByRole('dialog', { name: 'リストを追加' });
  await list.getByLabel('名前').fill('実スタックの色');
  await list.getByLabel('緑', { exact: true }).check();
  await list.getByRole('button', { name: '保存する' }).click();
  await expect(page.locator('.toast-visible')).toContainText('リスト「実スタックの色」を保存しました');
  await page.reload();
  await expect(page.getByRole('button', { name: 'リスト「実スタックの色」を編集' })).toBeVisible();
});

// サインインの上限はメールアドレスごとなので、ほかの試験があまり使わない人で確かめる。
test('the version banner appears only when the served build differs', async ({ page }) => {
  await signIn(page, 'sora@example.test', PASSWORD);
  await expect(page.getByRole('button', { name: '読み込み直す' })).toHaveCount(0);
  await page.route('**/v1/version', (route) => route.fulfill({ json: { build: 'a-later-build' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const banner = page.getByRole('status').filter({ hasText: '新しい版があります' });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: '読み込み直す' })).toBeVisible();
  await page.route('**/v1/version', (route) => route.fulfill({ json: { build: 'development' } }));
  await page.reload();
  await expect(page.getByRole('button', { name: '読み込み直す' })).toHaveCount(0);
});

test('member scope, two panes and resync work on real data', async ({ page }) => {
  // 一覧の横に詳細を並べるのは、本文（#main）が 1100px 以上のとき（段階8）。レールを除くので窓は 1440px。
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'hana@example.test', PASSWORD);
  await page.goto('/tasks');
  await expect(page.getByRole('link', { name: /音読の記録/ })).toBeVisible();
  await page.getByLabel('表示する人').selectOption({ label: '蓮' });
  await expect(page.getByRole('link', { name: /音読の記録/ })).toHaveCount(0);
  await page.getByLabel('表示する人').selectOption({ label: '自分' });
  await page.getByRole('link', { name: /音読の記録/ }).click();
  await expect(page.locator('.detail-pane').getByRole('heading', { name: '音読の記録' })).toBeVisible();
  await page.goto('/today');
  await page.getByRole('button', { name: '今すぐ更新' }).click();
  await expect(page.locator('.toast-visible')).toContainText('最新の内容に更新しました');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: '今すぐ更新' }).click();
  await expect(page.getByText('更新できませんでした。接続を確認して、もう一度お試しください。')).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'もう一度更新' }).click();
  await expect(page.locator('.toast-visible')).toContainText('最新の内容に更新しました');
});

test('legal drafts open before signing in, help works under the real headers', async ({ page }) => {
  const violations = failOnCspViolation(page);
  await page.goto('/sign-up');
  await page.goto('/settings/legal');
  await expect(page).toHaveURL(/\/settings\/legal/);
  await expect(page.getByRole('heading', { name: '利用規約（草案）' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'プライバシーポリシー（草案）' })).toBeVisible();
  await signIn(page, 'yui@example.test', PASSWORD);
  await page.goto('/settings/help?q=heic');
  await expect(page.getByRole('status').filter({ hasText: '1件の質問' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('theme, density and blur persist on this device under the real headers', async ({ page }) => {
  await signIn(page, 'yui@example.test', PASSWORD);
  await page.goto('/settings/accessibility');
  await page.getByLabel('川').check();
  await page.getByLabel('夜', { exact: true }).check();
  await page.getByLabel('コンパクト').check();
  await page.goto('/settings/privacy');
  await page.getByRole('button', { name: '隠れている間は画面をぼかす' }).click();
  await page.reload();
  const root = await page.evaluate(() => ({ ...document.documentElement.dataset }));
  expect(root).toMatchObject({ theme: 'modern-night', density: 'compact' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('root')!).filter)).toContain('blur');
});
