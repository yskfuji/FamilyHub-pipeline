import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const roster = ['2026年10月 シフト表', '氏名\t1\t2\t3\t4\t5\t6', '\t木\t金\t土\t日\t月\t火', '田中 花\tA\tB\t休\tC\tA\t研修', '碧\t早\t遅\t休\t夜\t早\t研修'].join('\n');

const openShift = async (page: Page) => {
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'シフトを読み取る' }).click();
  return page.getByRole('dialog', { name: 'シフトを読み取る' });
};

const pasteRoster = async (page: Page) => {
  const dialog = await openShift(page);
  await dialog.getByLabel('勤務表の文字').fill(roster);
  await expect(dialog.getByRole('table')).toBeVisible();
  return dialog;
};

test('shift reading proposes rows for the viewer and saves only after pressing save', async ({ page }) => {
  const dialog = await pasteRoster(page);
  await expect(dialog.getByLabel('対象の月')).toHaveValue('2026-10');
  await expect(dialog.getByLabel('表の中の人')).toHaveValue('碧');
  await expect(dialog.getByRole('table').getByRole('row')).toHaveCount(7);
  await expect(dialog.getByText('6件中5件')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /10月6日.*研修/ })).toBeDisabled();

  // 夜勤の行は翌日に終わる。外した行は保存しない。
  await expect(dialog.getByRole('row', { name: /夜勤/ })).toContainText('22:00〜翌07:00');
  await dialog.getByRole('checkbox', { name: /10月3日.*休み/ }).uncheck();
  await dialog.getByRole('button', { name: '規則を追加', exact: false }).first().click();

  await dialog.getByLabel('勤務のリスト').selectOption({ index: 1 });
  await expect(dialog.getByRole('row', { name: /研修/ })).toContainText('09:00〜18:00');
  await dialog.getByRole('button', { name: '5件を保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.toast-visible')).toContainText('5件の予定を保存しました');
});

test('choosing another person reads their row', async ({ page }) => {
  const dialog = await pasteRoster(page);
  await dialog.getByLabel('表の中の人').selectOption('田中 花');
  await expect(dialog.getByRole('row', { name: /A勤務/ }).first()).toContainText('09:00〜18:00');
});

test('a saved shift shows on the calendar, and pasting it again marks it as already there', async ({ page }) => {
  let dialog = await pasteRoster(page);
  await dialog.getByRole('button', { name: /件を保存/ }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'シフトを読み取る' }).click();
  dialog = page.getByRole('dialog', { name: 'シフトを読み取る' });
  await dialog.getByLabel('勤務表の文字').fill(roster);
  await expect(dialog.getByText('同じ予定があります').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: '0件を保存' })).toBeDisabled();
});

test('time rules are edited, kept on this device and applied to the table', async ({ page }) => {
  const dialog = await pasteRoster(page);
  await dialog.getByText('時刻の規則').click();
  await dialog.locator('[data-control-id="calendar.shift.rule.start.early"]').fill('05:30');
  await expect(dialog.getByRole('row', { name: /早番/ }).first()).toContainText('05:30〜16:00');
  await dialog.getByLabel('見本から規則を作る').fill('研修=10:00-15:00');
  await dialog.getByRole('button', { name: '見本から保存' }).click();
  await expect(dialog.getByRole('row', { name: /研修/ })).toContainText('10:00〜15:00');
  await expect(dialog.getByRole('checkbox', { name: /10月6日.*研修/ })).toBeEnabled();

  await page.reload();
  const again = await openShift(page);
  await again.getByLabel('勤務表の文字').fill('10/1 早番');
  await expect(again.getByRole('row', { name: /早番/ })).toContainText('05:30〜16:00');
  await again.getByText('時刻の規則').click();
  await again.getByRole('button', { name: '初期の規則に戻す' }).click();
  await expect(again.getByRole('row', { name: /早番/ })).toContainText('07:00〜16:00');
});

test('leaving with pasted text asks first', async ({ page }) => {
  const dialog = await pasteRoster(page);
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByRole('dialog', { name: '入力中の内容を破棄しますか' })).toBeVisible();
});

test('the review counts records, cites them and opens a draft without saving', async ({ page }) => {
  await page.goto('/insights');
  const review = page.getByRole('region', { name: '記録を数えた結果' });
  await expect(review).toContainText('数えて比べているだけです');
  await expect(review).not.toContainText('AI');
  await expect(review.getByRole('table')).toContainText('碧');
  const unsettled = review.getByRole('article').filter({ hasText: '未精算の合計' });
  await expect(unsettled.getByRole('link').first()).toHaveAttribute('href', /^\/budget\//);
  await unsettled.getByRole('button', { name: '精算の予定を下書きする' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await expect(form.getByLabel('予定名')).toHaveValue('家計の精算');
  await expect(form).toContainText('振り返りから作った下書きです');
  await form.getByRole('button', { name: 'キャンセル' }).click();
  await expect(form).toBeHidden();
  await page.goto('/calendar?view=list');
  await expect(page.getByText('家計の精算')).toHaveCount(0);
});

test('scope toggles change what is counted', async ({ page }) => {
  await page.goto('/insights');
  const review = page.getByRole('region', { name: '記録を数えた結果' });
  await expect(review.getByText(/未精算の合計/)).toBeVisible();
  await review.getByRole('checkbox', { name: '家計' }).uncheck();
  await expect(review.getByText(/未精算の合計/)).toHaveCount(0);
  await review.getByRole('checkbox', { name: '予定' }).uncheck();
  await review.getByRole('checkbox', { name: 'タスク' }).uncheck();
  await expect(review.getByText('挙げることはありません')).toBeVisible();
});

test('a conflict between two events shows up and links to both', async ({ page }) => {
  await page.goto('/calendar');
  for (const title of ['歯医者', '面談']) {
    await page.getByRole('button', { name: '予定を追加' }).first().click();
    const form = page.getByRole('dialog', { name: 'すぐに追加' });
    await form.getByLabel('予定名').fill(title);
    await form.getByLabel('開始', { exact: true }).fill('2026-10-02T10:00');
    await form.getByLabel('終了', { exact: true }).fill('2026-10-02T11:00');
    await form.getByRole('button', { name: '追加する' }).click();
    await expect(form).toBeHidden();
  }
  await page.locator('nav').getByRole('link', { name: 'ヒント' }).first().click();
  const finding = page.getByRole('article').filter({ hasText: '予定が重なっています' });
  await expect(finding).toContainText('「歯医者」');
  await expect(finding.getByRole('link')).toHaveCount(2);
});

test('a receipt fills the expense form for review and saves nothing by itself', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: '領収書を読み取る' }).click();
  const dialog = page.getByRole('dialog', { name: '領収書を読み取る' });
  await expect(dialog).toContainText('見本');
  await dialog.getByLabel('領収書の画像').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: '読み取る' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await expect(form.getByLabel('支出名')).toHaveValue('見本スーパー 青葉店');
  await expect(form.getByLabel('金額（円）')).toHaveValue('2480');
  await expect(form.getByLabel('日付')).toHaveValue('2026-09-29');
  await expect(form.getByLabel('費目')).toHaveValue('food');
  await expect(form).toContainText('見本のデータです');
  await form.getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.getByRole('link', { name: '見本スーパー 青葉店' })).toHaveCount(0);
});

test('a file that is not an image is refused with a reason', async ({ page }) => {
  await page.goto('/budget');
  await page.getByRole('button', { name: '領収書を読み取る' }).click();
  const dialog = page.getByRole('dialog', { name: '領収書を読み取る' });
  await dialog.getByLabel('領収書の画像').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await dialog.getByRole('button', { name: '読み取る' }).click();
  await expect(dialog.getByRole('alert')).toContainText('JPEGとPNG');
});

test('a page offers candidates, and a candidate opens the event form', async ({ page }) => {
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'URL・チラシから読み取る' }).click();
  const dialog = page.getByRole('dialog', { name: 'URL・チラシから読み取る' });
  await dialog.getByLabel('ページのURL').fill('http://example.com/');
  await dialog.getByRole('button', { name: '読み取る' }).click();
  await expect(dialog.getByRole('alert')).toContainText('https');
  await dialog.getByLabel('ページのURL').fill('https://example.com/festival');
  await dialog.getByRole('button', { name: '読み取る' }).click();
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: '「見本の区民まつり」を入力して開く' }).click();
  const form = page.getByRole('dialog', { name: 'すぐに追加' });
  await expect(form.getByLabel('予定名')).toHaveValue('見本の区民まつり');
  await expect(form.getByLabel('開始', { exact: true })).toHaveValue('2026-10-27T10:00');
  await expect(form.getByLabel('終了', { exact: true })).toHaveValue('2026-10-27T15:30');
  await expect(form.getByLabel('場所（任意）')).toHaveValue('中央公園');
});

test('a flyer image also offers candidates', async ({ page }) => {
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'URL・チラシから読み取る' }).click();
  const dialog = page.getByRole('dialog', { name: 'URL・チラシから読み取る' });
  await dialog.getByRole('button', { name: 'チラシの画像' }).click();
  await dialog.getByLabel('チラシの画像').setInputFiles({ name: 'flyer.png', mimeType: 'image/png', buffer: png });
  await dialog.getByRole('button', { name: '読み取る' }).click();
  await expect(dialog.getByRole('button', { name: /予備日/ })).toBeVisible();
  await dialog.getByRole('button', { name: /予備日/ }).click();
  await expect(page.getByRole('dialog', { name: 'すぐに追加' }).getByRole('checkbox', { name: '終日' })).toBeChecked();
});

test('each role sees only the helpers it may use', async ({ page }) => {
  await page.goto('/budget?actor=member-ren');
  await expect(page.getByRole('button', { name: '領収書を読み取る' })).toBeVisible();
  await page.goto('/calendar?actor=member-hana');
  await expect(page.getByRole('button', { name: 'シフトを読み取る' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'URL・チラシから読み取る' })).toHaveCount(0);
  await page.goto('/calendar?actor=member-yui');
  await expect(page.getByRole('heading', { name: '家族の予定' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'シフトを読み取る' })).toHaveCount(0);
});

test('the shift dialog and the review pass axe', async ({ page }) => {
  const dialog = await pasteRoster(page);
  await dialog.getByText('時刻の規則').click();
  const shift = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(shift.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
  await page.goto('/insights');
  await expect(page.getByRole('region', { name: '記録を数えた結果' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const review = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(review.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
});

test('the reading controls stay 44 pixels tall on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await pasteRoster(page);
  const box = await dialog.locator('.shift-check').first().boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  // 位置が端数のとき、boundingBox の高さは 44 より 0.00002 ほど小さく返ることがある（CSS の高さは 44px ちょうど）。
  for (const button of await page.locator('.calendar-readers .button').all()) expect(Math.round(((await button.boundingBox())?.height ?? 0) * 100) / 100).toBeGreaterThanOrEqual(44);
  const overflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
