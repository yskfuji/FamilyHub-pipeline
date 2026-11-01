import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PASSWORD, failOnCspViolation, signIn } from './support';

// 円記号はブラウザの Intl 実装で全角と半角が異なるため、どちらも受け付ける。
const yen = (amount: string) => `[¥￥]${amount.replace(',', '\\,')}`;

/** このファイルの記録だけを探せるように、試すたびに違う名前にする。 */
const unique = (label: string) => `${label}${Date.now().toString(36)}`;

async function addRecord(page: Page, kind: '支出' | '収入', fill: (form: ReturnType<Page['getByRole']>) => Promise<void>) {
  await page.goto('/budget');
  await page.getByRole('button', { name: `${kind}を追加` }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await fill(form);
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(form).toBeHidden();
  await expect(page.locator('.toast-visible')).toContainText(`${kind}を追加しました`);
}

/** このファイルは蓮として動かす。サインインの回数の上限はメールアドレスごとなので、ほかのファイルの碧の回数を増やさない。 */
const signInAsRen = (page: Page) => signIn(page, 'ren@example.test');

const passwordPrompt = (page: Page) => page.getByRole('dialog', { name: '本人確認', exact: true });

/** 確認の有効時間を過ぎてから操作し、本人確認を通す。実スタックでは有効時間を短くしている。 */
async function withPassword(page: Page, action: () => Promise<void>) {
  await page.waitForTimeout(2100);
  await action();
  await expect(passwordPrompt(page)).toBeVisible();
  await passwordPrompt(page).getByLabel('パスワード').fill(PASSWORD);
  await passwordPrompt(page).getByRole('button', { name: '続ける' }).click();
  await expect(passwordPrompt(page)).toHaveCount(0);
}

test('income saves through the API and stays apart from spending', async ({ page }) => {
  const violations = failOnCspViolation(page);
  const title = unique('実スタックの収入');
  await signInAsRen(page);
  await addRecord(page, '収入', async (form) => {
    await form.getByLabel('収入名').fill(title);
    await form.getByLabel('金額（円）').fill('50000');
    await form.getByLabel('費目').selectOption('income_side');
  });
  await page.reload();
  await page.getByRole('button', { name: '一覧', exact: true }).click();
  await page.getByLabel('費目').selectOption('income_side');
  await page.getByRole('link', { name: title }).click();
  const drawer = page.getByRole('dialog', { name: title });
  await expect(drawer.locator('.detail-list')).toContainText('副収入');
  await expect(drawer.getByRole('table')).toHaveCount(0);
  await drawer.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('button', { name: 'メンバー別', exact: true }).click();
  await expect(page.getByText(new RegExp(yen('50,000')))).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('month navigation, filtering and sorting read the stored records', async ({ page }) => {
  await signInAsRen(page);
  await page.goto('/budget?view=list&month=2026-09');
  await expect(page.getByRole('link', { name: '週末の食材' })).toBeVisible();
  await page.getByLabel('費目').selectOption('transport');
  await expect(page).toHaveURL(/category=transport/);
  await expect(page.locator('.ledger-group .row-link')).toHaveText(['家族のおでかけ交通費']);
  await page.getByLabel('費目').selectOption('');
  await page.getByLabel('並べ替え').selectOption('amount-high');
  await expect(page.locator('.ledger-group .row-link').first()).toHaveText('9月の給与');
  await expect(page.locator('.ledger-group .row-link').last()).toHaveText('学校教材');
  await page.getByRole('button', { name: '前月' }).click();
  await expect(page).toHaveURL(/month=2026-08/);
  await expect(page.locator('.ledger-group .row-link')).toHaveText(['8月の電気代']);
  await page.getByRole('button', { name: '今月' }).click();
  await expect(page).not.toHaveURL(/month=/);
});

test('a custom split is stored exactly and a partial settlement leaves the rest open until reversed', async ({ page }) => {
  const violations = failOnCspViolation(page);
  const title = unique('実スタックの負担');
  await signInAsRen(page);
  await addRecord(page, '支出', async (form) => {
    await form.getByLabel('支出名').fill(title);
    await form.getByLabel('金額（円）').fill('3000');
    await form.getByRole('radio', { name: '金額を指定' }).check();
    await form.getByLabel('碧さんの負担（円）').fill('2000');
    await form.getByLabel('蓮さんの負担（円）').fill('1000');
  });
  await page.getByRole('link', { name: title }).click();
  const drawer = page.getByRole('dialog', { name: title });
  await expect(drawer.getByRole('row', { name: /^碧/ })).toContainText(new RegExp(`${yen('2,000')}.*${yen('0')}.*${yen('2,000')}`));

  await drawer.getByRole('button', { name: new RegExp(`^半分（${yen('1,000')}）$`) }).click();
  await withPassword(page, () => drawer.getByRole('button', { name: new RegExp(`^碧さんの${yen('1,000')}を精算$`) }).click());
  await expect(drawer.getByText('碧さんから蓮さんへ')).toBeVisible();
  await expect(drawer.getByRole('row', { name: /^碧/ })).toContainText(new RegExp(`${yen('1,000')}.*${yen('1,000')}`));
  await expect(drawer.getByRole('button', { name: new RegExp(`^碧さんの残り${yen('1,000')}を精算$`) })).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole('dialog', { name: title });
  await expect(reloaded.getByRole('button', { name: '支出を削除' })).toBeDisabled();
  await withPassword(page, () => reloaded.getByRole('button', { name: new RegExp(`の${yen('1,000')}の精算を取り消す$`) }).click());
  await expect(reloaded.getByText('取り消し済み')).toBeVisible();
  await expect(reloaded.getByText(/^取り消し（碧さんの精算）$/)).toBeVisible();
  await expect(reloaded.getByRole('button', { name: new RegExp(`^碧さんの残り${yen('2,000')}を精算$`) })).toBeVisible();
  await expect(reloaded.getByRole('button', { name: '支出を削除' })).toBeEnabled();
  expect(violations).toEqual([]);
});

test('a partial settlement asks for the password again, keeps the typed amount and records it once', async ({ page }) => {
  const title = unique('実スタックの本人確認');
  await signInAsRen(page);
  await addRecord(page, '支出', async (form) => {
    await form.getByLabel('支出名').fill(title);
    await form.getByLabel('金額（円）').fill('2000');
  });
  await page.getByRole('link', { name: title }).click();
  const drawer = page.getByRole('dialog', { name: title });
  const amount = drawer.getByLabel(/碧さんの精算額/);
  const settle = drawer.getByRole('button', { name: new RegExp(`^碧さんの${yen('300')}を精算$`) });
  await amount.fill('300');
  await page.waitForTimeout(2100);
  await settle.click();

  await expect(passwordPrompt(page)).toBeVisible();
  await passwordPrompt(page).getByRole('button', { name: 'やめる' }).click();
  await expect(passwordPrompt(page)).toHaveCount(0);
  await expect(drawer.getByRole('alert')).toBeVisible();
  await expect(amount).toHaveValue('300');
  await expect(drawer.getByText('精算の記録はまだありません。')).toBeVisible();

  await withPassword(page, () => settle.click());
  await expect(drawer.getByRole('row', { name: /^碧/ })).toContainText(new RegExp(`${yen('300')}.*${yen('700')}`));
  await expect(drawer.locator('.history-list .list-row')).toHaveCount(1);
});

test('deleting asks for the password again and the record can be restored', async ({ page }) => {
  const title = unique('実スタックの削除');
  await signInAsRen(page);
  await addRecord(page, '支出', async (form) => {
    await form.getByLabel('支出名').fill(title);
    await form.getByLabel('金額（円）').fill('100');
    await form.getByRole('radio', { name: '支払った人だけ' }).check();
  });
  await page.getByRole('link', { name: title }).click();
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: '支出を削除' }).click();
  await withPassword(page, () => page.getByRole('dialog', { name: '支出を削除しますか' }).getByRole('button', { name: '削除する' }).click());
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
  await withPassword(page, () => page.getByRole('button', { name: '元に戻す' }).click());
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});
