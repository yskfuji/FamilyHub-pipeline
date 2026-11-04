import { expect, test } from './fixtures';

// 円記号はブラウザの Intl 実装で全角（Chromium）と半角（WebKit）が異なるため、どちらも受け付ける。
const yen = (amount: string) => `[¥￥]${amount.replace(',', '\\,')}`;

test('metrics, categories and who-owes-whom are computed from records', async ({ page }) => {
  await page.goto('/budget');
  await expect(page.getByText('2026年9月の支出3件の合計')).toBeVisible();
  await expect(page.locator('.metric').first()).toHaveText(new RegExp(`^${yen('12,060')}$`));
  const categories = page.getByRole('region', { name: '9月の支出の内訳' }).locator('li');
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
  await page.getByRole('button', { name: '精算', exact: true }).click();
  await expect(page).toHaveURL(/\?view=settlements$/);
  const history = page.getByRole('heading', { name: '精算の履歴' }).locator('xpath=ancestor::section[1]');
  await expect(history.getByText('取り消し済み')).toBeVisible();
  await expect(history.getByRole('link', { name: '学校教材' }).first()).toHaveAttribute('href', '/budget/expense-books?view=settlements');
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

test('overview shows the balance, the month comparison and links into the list', async ({ page }) => {
  await page.goto('/budget');
  await expect(page.getByText('2026年9月の支出3件の合計')).toBeVisible();
  await expect(page.locator('.metric').nth(1)).toHaveText(new RegExp(`^${yen('320,000')}$`));
  await expect(page.locator('.metric').nth(2)).toHaveText(new RegExp(`^\\+${yen('307,940')}$`));
  await expect(page.getByText(new RegExp(`^収入の3%を支出にあて、${yen('307,940')}残っています。$`))).toBeVisible();
  await expect(page.getByText(new RegExp(`^支出は先月（8月）より${yen('2,260')}多いです。$`))).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近の記録' }).locator('xpath=ancestor::section[1]').getByRole('link')).toHaveCount(5);
  await expect(page.getByRole('region', { name: '9月の収入の内訳' })).toContainText('給与');
  await expect(page.getByRole('heading', { name: '誰にいくら支払うか' }).locator('..')).toContainText(new RegExp(`残りのある記録が2件、合計${yen('3,110')}です。`));
  await page.getByRole('link', { name: /^食費の記録を見る/ }).click();
  await expect(page).toHaveURL(/\/budget\?view=list&category=food$/);
  await expect(page.getByLabel('費目')).toHaveValue('food');
  await expect(page.getByRole('link', { name: '週末の食材' })).toBeVisible();
  await expect(page.getByRole('link', { name: '学校教材' })).toHaveCount(0);
});

test('month navigation moves the totals, stops at the latest month and comes back', async ({ page }) => {
  await page.goto('/budget');
  await expect(page.getByRole('button', { name: '次月' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '今月' })).toBeDisabled();
  await page.getByRole('button', { name: '前月' }).click();
  await expect(page).toHaveURL(/\?month=2026-08$/);
  await expect(page.getByText('2026年8月', { exact: true })).toBeVisible();
  await expect(page.locator('.metric').first()).toHaveText(new RegExp(`^${yen('9,800')}$`));
  await expect(page.getByText('この月の収入の記録はありません。')).toBeVisible();
  await expect(page.getByText('先月（7月）の支出の記録はありません。')).toBeVisible();
  await page.getByRole('button', { name: '前月' }).click();
  await expect(page.getByRole('heading', { name: '2026年7月の記録はありません' })).toBeVisible();
  await page.getByRole('button', { name: '今月' }).click();
  await expect(page).toHaveURL(/\/budget$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?month=2026-07$/);
  await page.getByRole('button', { name: '次月' }).click();
  await expect(page).toHaveURL(/\?month=2026-08$/);
  await page.goto('/budget?month=2030-01');
  await expect(page.getByText('2026年9月', { exact: true })).toBeVisible();
});

test('a tab and its month survive opening and closing a record', async ({ page }) => {
  await page.goto('/budget?view=list&month=2026-08');
  await page.getByRole('link', { name: '8月の電気代' }).click();
  await expect(page).toHaveURL(/\/budget\/expense-august-utilities\?view=list&month=2026-08$/);
  const drawer = page.getByRole('dialog', { name: '8月の電気代' });
  await expect(drawer.getByText('支払った人だけの負担なので、精算はありません。')).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page).toHaveURL(/\/budget\?view=list&month=2026-08$/);
  await expect(page.getByRole('button', { name: '一覧', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the list filters by category and period, and offers six sort orders', async ({ page }) => {
  await page.goto('/budget?view=list');
  const rows = page.locator('.ledger-group .list-row');
  await expect(rows).toHaveCount(4);
  await expect(page.getByRole('status').filter({ hasText: '4件' })).toContainText('2026年9月1日〜2026年9月30日');
  await expect(page.getByRole('heading', { name: '9月29日(火)' }).locator('..')).toContainText(new RegExp(`支出 ${yen('2,860')}`));
  await expect(page.getByRole('heading', { name: '9月25日(金)' }).locator('..')).toContainText(new RegExp(`収入 ${yen('320,000')}`));

  await page.getByLabel('期間').selectOption('week');
  await expect(page).toHaveURL(/period=week/);
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('link', { name: '週末の食材' })).toHaveCount(0);

  await page.getByLabel('期間').selectOption('custom');
  await page.getByLabel('開始日').fill('2026-08-01');
  await page.getByLabel('終了日').fill('2026-09-26');
  await expect(page).toHaveURL(/period=custom&from=2026-08-01&to=2026-09-26/);
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole('link', { name: '8月の電気代' })).toBeVisible();

  await page.getByLabel('費目').selectOption('income_bonus');
  await expect(page).toHaveURL(/category=income_bonus/);
  await expect(page.getByRole('heading', { name: '該当する記録はありません' })).toBeVisible();
  await page.getByRole('button', { name: '絞り込みを外す' }).click();
  await expect(page).toHaveURL(/\/budget\?view=list$/);
  await expect(rows).toHaveCount(4);

  await expect(page.getByLabel('並べ替え').locator('option')).toHaveCount(6);
  const titles = () => page.locator('.ledger-group .row-link');
  await page.getByLabel('並べ替え').selectOption('amount-high');
  await expect(page).toHaveURL(/sort=amount-high/);
  await expect(titles()).toHaveText(['9月の給与', '週末の食材', '家族のおでかけ交通費', '学校教材']);
  await expect(page.locator('.ledger-day')).toHaveCount(0);
  await page.getByLabel('並べ替え').selectOption('amount-low');
  await expect(titles()).toHaveText(['学校教材', '家族のおでかけ交通費', '週末の食材', '9月の給与']);
  await page.getByLabel('並べ替え').selectOption('category');
  await expect(titles()).toHaveText(['週末の食材', '家族のおでかけ交通費', '学校教材', '9月の給与']);
  await page.getByLabel('並べ替え').selectOption('payer');
  await expect(titles()).toHaveText(['学校教材', '週末の食材', '9月の給与', '家族のおでかけ交通費']);
  await page.getByLabel('並べ替え').selectOption('date-old');
  await expect(titles()).toHaveText(['9月の給与', '週末の食材', '家族のおでかけ交通費', '学校教材']);
  await page.getByLabel('並べ替え').selectOption('date-new');
  await expect(page).toHaveURL(/\/budget\?view=list$/);
});

test('the member view adds up paid, burden and the difference for the month', async ({ page }) => {
  await page.goto('/budget?view=members');
  const table = page.getByRole('table');
  await expect(table.getByRole('row', { name: /^碧/ })).toContainText(new RegExp(`${yen('8,700')}.*${yen('6,030')}.*\\+${yen('2,670')}`));
  await expect(table.getByRole('row', { name: /^蓮/ })).toContainText(new RegExp(`${yen('3,360')}.*${yen('6,030')}.*−${yen('2,670')}`));
  await expect(table.getByRole('row', { name: /^合計/ })).toContainText(new RegExp(`${yen('12,060')}.*${yen('12,060')}.*${yen('0')}`));
  await page.getByRole('button', { name: '前月' }).click();
  await expect(table.getByRole('row', { name: /^蓮/ })).toContainText(new RegExp(`${yen('9,800')}.*${yen('9,800')}.*${yen('0')}$`));
  await page.goto('/budget?view=members&month=2026-07');
  await expect(page.getByRole('heading', { name: 'この月の支出はありません' })).toBeVisible();
});

test('the settlement view nets all open records, ignores the month and keeps the history', async ({ page }) => {
  await page.goto('/budget?view=settlements&month=2026-08');
  await expect(page.getByRole('group', { name: '表示する月の移動' })).toHaveCount(0);
  await expect(page.getByText('碧さんから蓮さんへ')).toBeVisible();
  await expect(page.getByRole('heading', { name: '誰が誰に渡せば済むか' }).locator('..')).toContainText(new RegExp(yen('250')));
  const open = page.getByRole('region', { name: '残りのある記録' });
  await expect(open.locator('.row-link')).toHaveText(['家族のおでかけ交通費', '学校教材']);
  await expect(page.getByRole('region', { name: '精算の履歴' })).toContainText('蓮さんから碧さんへ');
});

test('income is recorded with its own categories and no split', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: '収入を追加' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await expect(form.getByRole('radio', { name: '収入' })).toBeChecked();
  await expect(form.getByText('負担の分け方')).toHaveCount(0);
  await expect(form.getByRole('button', { name: '場所を追加（任意）' })).toHaveCount(0);
  await expect(form.getByLabel('費目').locator('option')).toHaveCount(6);
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(form.getByRole('alert')).toHaveText('収入名を入力してください。');
  await form.getByLabel('収入名').fill('臨時の手当');
  await form.getByLabel('金額（円）').fill('１０,０００');
  await form.getByLabel('費目').selectOption('income_bonus');
  await form.getByLabel('受け取った人').selectOption('member-ren');
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(page.locator('.toast-visible')).toContainText('収入を追加しました');
  await expect(page.locator('.metric').nth(1)).toHaveText(new RegExp(`^${yen('330,000')}$`));
  await expect(page.locator('.metric').first()).toHaveText(new RegExp(`^${yen('12,060')}$`));

  await page.getByRole('link', { name: '臨時の手当' }).click();
  const drawer = page.getByRole('dialog', { name: '臨時の手当' });
  await expect(drawer.getByText('受け取った人', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('table')).toHaveCount(0);
  await drawer.getByRole('button', { name: '内容を編集' }).click();
  const edit = page.getByRole('dialog', { name: '収入を編集' });
  // 記録したあとも種類を変えられる（A3-5）。開いたときは今の種類が選ばれている。
  await expect(edit.getByRole('radio', { name: '収入' })).toBeChecked();
  await edit.getByLabel('金額（円）').fill('20000');
  await edit.getByRole('button', { name: '変更を保存' }).click();
  await expect(drawer.locator('.detail-list')).toContainText(new RegExp(yen('20,000')));
});

test('switching the form to income changes its categories and drops the split', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: '支出を追加' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await expect(form.getByLabel('費目').locator('option')).toHaveCount(11);
  await form.getByRole('radio', { name: '収入' }).check();
  await expect(form.getByLabel('費目')).toHaveValue('income_other');
  await form.getByRole('radio', { name: '支出' }).check();
  await expect(form.getByLabel('費目')).toHaveValue('other');
  await expect(form.getByText('負担の分け方')).toBeVisible();
});

test('a custom split must add up to the amount and is saved exactly', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: '支出を追加' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await form.getByLabel('支出名').fill('家族の夕食');
  await form.getByLabel('金額（円）').fill('1001');
  await expect(form.getByText(new RegExp(`碧さん ${yen('501')}・蓮さん ${yen('500')}`))).toBeVisible();
  await form.getByRole('radio', { name: '金額を指定' }).check();
  await expect(form.getByLabel('碧さんの負担（円）')).toHaveValue('501');
  await form.getByLabel('碧さんの負担（円）').fill('800');
  await expect(form.getByText(new RegExp(`金額より${yen('299')}多くなっています。`))).toBeVisible();
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(form.getByRole('alert')).toHaveText('負担の合計を金額と合わせてください。');
  await form.getByLabel('蓮さんの負担（円）').fill('201');
  await expect(form.getByText('負担の合計は金額と同じです。')).toBeVisible();
  await form.getByRole('button', { name: '追加する' }).click();
  await expect(page.getByRole('dialog', { name: 'すぐに追加' })).toBeHidden();
  await page.getByRole('link', { name: '家族の夕食' }).click();
  const table = page.getByRole('dialog', { name: '家族の夕食' }).getByRole('table');
  await expect(table.getByRole('row', { name: /^碧/ })).toContainText(new RegExp(yen('800')));
  await expect(table.getByRole('row', { name: /^蓮/ })).toContainText(new RegExp(`${yen('201')}.*${yen('0')}.*${yen('201')}`));
});

test('payer only leaves nothing to settle, and warns when a person sharing the cost could not see it', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: '支出を追加' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await form.getByLabel('支出名').fill('自分の買い物');
  await form.getByLabel('金額（円）').fill('500');
  await form.getByLabel('公開範囲').selectOption('creator');
  await expect(form.getByText('蓮さんには、この公開範囲だと記録が表示されません。')).toBeVisible();
  await form.getByRole('radio', { name: '支払った人だけ' }).check();
  await expect(form.getByText('蓮さんには、この公開範囲だと記録が表示されません。')).toHaveCount(0);
  await form.getByRole('button', { name: '追加する' }).click();
  await page.getByRole('link', { name: '自分の買い物' }).click();
  const drawer = page.getByRole('dialog', { name: '自分の買い物' });
  await expect(drawer.getByText('支払った人だけの負担なので、精算はありません。')).toBeVisible();
  await expect(drawer.locator('.detail-list')).toContainText('作成した本人');
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('button', { name: '精算', exact: true }).click();
  await expect(page.getByRole('region', { name: '残りのある記録' }).getByRole('link', { name: '自分の買い物' })).toHaveCount(0);
});

test('partial settlement checks the limit, leaves the remainder open, and reversal keeps the history', async ({ page }) => {
  await page.goto('/budget/expense-books');
  const drawer = page.getByRole('dialog', { name: '学校教材' });
  const amount = drawer.getByLabel(/蓮さんの精算額/);
  await expect(amount).toHaveValue('1,430');
  await amount.fill('2000');
  await drawer.getByRole('button', { name: new RegExp(`^蓮さんの${yen('2,000')}を精算$`) }).click();
  await expect(drawer.getByRole('alert')).toContainText(new RegExp(`残りの${yen('1,430')}以下`));
  await expect(drawer.getByText('精算の記録はまだありません。')).toBeVisible();
  await amount.fill('0');
  await drawer.getByRole('button', { name: '蓮さんの精算を記録' }).click();
  await expect(drawer.getByRole('alert')).toContainText('1円以上の整数');

  await drawer.getByRole('button', { name: new RegExp(`^半分（${yen('715')}）$`) }).click();
  await expect(amount).toHaveValue('715');
  await drawer.getByRole('button', { name: new RegExp(`^残り全額（${yen('1,430')}）$`) }).click();
  await expect(amount).toHaveValue('1,430');
  await amount.fill('430');
  await drawer.getByRole('button', { name: new RegExp(`^蓮さんの${yen('430')}を精算$`) }).click();
  await expect(page.locator('.toast-visible')).toContainText('精算を記録');
  await expect(drawer.getByRole('row', { name: /^蓮/ })).toContainText(new RegExp(`${yen('430')}.*${yen('1,000')}`));
  await expect(amount).toHaveValue('1,000');
  await expect(drawer.getByRole('button', { name: new RegExp(`^蓮さんの残り${yen('1,000')}を精算$`) })).toBeVisible();

  await expect(drawer.getByRole('button', { name: '支出を削除' })).toBeDisabled();
  await drawer.getByRole('button', { name: '内容を編集' }).click();
  const edit = page.getByRole('dialog', { name: '支出を編集' });
  await expect(edit.getByText('精算の記録があるため、金額・支払った人・負担する人は変更できません。')).toBeVisible();
  await expect(edit.getByLabel('金額（円）')).toBeDisabled();
  await expect(edit.getByRole('combobox', { name: /^支払った人/ })).toBeDisabled();
  await expect(edit.getByRole('radio', { name: '金額を指定' })).toBeDisabled();
  await edit.getByRole('button', { name: 'キャンセル' }).click();

  await drawer.getByRole('button', { name: new RegExp(`の${yen('430')}の精算を取り消す$`) }).click();
  await expect(drawer.getByText('取り消し済み')).toBeVisible();
  await expect(drawer.getByText(/^取り消し（蓮さんの精算）$/)).toBeVisible();
  await expect(amount).toHaveValue('1,430');
  await expect(drawer.getByRole('button', { name: '支出を削除' })).toBeEnabled();
});

test('only the creator and the payer are offered deletion', async ({ page }) => {
  await page.goto('/budget/expense-books?actor=member-ren');
  const books = page.getByRole('dialog', { name: '学校教材' });
  await expect(books.getByRole('button', { name: '内容を編集' })).toBeVisible();
  await expect(books.getByRole('button', { name: '支出を削除' })).toHaveCount(0);
  await page.goto('/budget/expense-train?actor=member-ren');
  await expect(page.getByRole('dialog', { name: '家族のおでかけ交通費' }).getByRole('button', { name: '支出を削除' })).toBeVisible();
});
