import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const dataset = (page: Page, name: string) => page.evaluate((key) => document.documentElement.dataset[key], name);
const openPalette = async (page: Page) => {
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('searchbox')).toBeFocused();
};
const scope = (page: Page) => page.getByLabel('表示する人');

test.describe('member scope', () => {
  test('filters tasks, notes, budget, calendar and today by involvement, and is remembered', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('link', { name: /図書館の本を返す/ })).toBeVisible();
    await scope(page).selectOption({ label: '花' });
    await expect(page.getByRole('link', { name: /音読の記録/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /図書館の本を返す/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^未完了 1$/ }).or(page.getByRole('button', { name: /1$/ }).first())).toBeVisible();
    await page.reload();
    await expect(scope(page).locator('option:checked')).toHaveText('花');
    await expect(page.getByRole('link', { name: /図書館の本を返す/ })).toHaveCount(0);

    await page.goto('/notes');
    await scope(page).selectOption({ label: '蓮' });
    await expect(page.getByRole('heading', { name: '小児科の控え' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '学校公開のお知らせ' })).toHaveCount(0);

    await page.goto('/budget?view=list');
    await scope(page).selectOption({ label: '花' });
    await expect(page.getByRole('link', { name: '学校教材' })).toHaveCount(0);

    await page.goto('/calendar?view=list&month=2026-10');
    await scope(page).selectOption({ label: 'すべて' });
    await expect(page.getByText('週末の公園').first()).toBeVisible();
    await scope(page).selectOption({ label: '結衣' });
    await expect(page.getByText('週末の公園')).toHaveCount(0);

    await page.goto('/today');
    await scope(page).selectOption({ label: '自分' });
    await expect(page.getByRole('heading', { name: '碧さんのタスク' })).toBeVisible();
    await scope(page).selectOption({ label: 'すべて' });
  });

  test('a detail URL still opens outside the chosen person', async ({ page }) => {
    await page.goto('/tasks');
    await scope(page).selectOption({ label: '花' });
    await page.goto('/tasks/todo-garbage');
    await expect(page.getByRole('dialog', { name: '資源ごみをまとめる' })).toBeVisible();
  });

  test('falls back to everyone when the remembered member cannot be chosen', async ({ page }) => {
    await page.goto('/today');
    await page.evaluate(() => localStorage.setItem('family-hub-member-scope', 'member-gone'));
    await page.goto('/tasks');
    await expect(scope(page).locator('option:checked')).toHaveText('すべて');
    await expect(page.getByRole('link', { name: /図書館の本を返す/ })).toBeVisible();
  });
});

test('the Tasks navigation shows the number of open tasks', async ({ page }) => {
  await page.goto('/today');
  await expect(page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'タスク 未完了4件' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'モバイルの主な機能' }).getByRole('link', { name: 'タスク 未完了4件' })).toBeVisible();
});

test.describe('command palette', () => {
  test('lists commands on an empty query and runs them from the keyboard', async ({ page }) => {
    await page.goto('/today');
    await openPalette(page);
    const panel = page.getByRole('dialog', { name: '家族の情報を検索' });
    for (const name of ['予定を開く', 'タスクを追加', '予定を追加', '支出を追加', 'メモを追加', '表示する人：自分', '表示の密度：コンパクト', 'テーマ：抹茶', '昼夜：夜']) await expect(panel.getByRole('button', { name })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(panel.getByRole('button', { name: '今日を開く' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(panel.getByRole('button', { name: '予定を開く' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('keeps search, and finds commands by name', async ({ page }) => {
    await page.goto('/today');
    await openPalette(page);
    await page.getByRole('searchbox').fill('学校');
    await expect(page.getByRole('link', { name: /学校公開/ }).first()).toBeVisible();
    await page.getByRole('searchbox').fill('抹茶');
    await page.getByRole('button', { name: 'テーマ：抹茶' }).click();
    await expect.poll(() => dataset(page, 'theme')).toBe('matcha');
  });

  test('opens the add form, and focus lands inside it', async ({ page }) => {
    await page.goto('/today');
    await openPalette(page);
    await page.getByRole('button', { name: 'タスクを追加' }).click();
    const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
    await expect(dialog.getByRole('button', { name: '閉じる' })).toBeFocused();
    await expect(dialog.getByLabel('タスク名')).toBeVisible();
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
  });

  test('switches member scope and density', async ({ page }) => {
    await page.goto('/tasks');
    await openPalette(page);
    await page.getByRole('button', { name: '表示する人：蓮' }).click();
    await expect(scope(page).locator('option:checked')).toHaveText('蓮');
    await openPalette(page);
    await page.getByRole('button', { name: '表示の密度：コンパクト' }).click();
    await expect.poll(() => dataset(page, 'density')).toBe('compact');
  });

  test('hides what the role cannot do', async ({ page }) => {
    await page.goto('/today?actor=member-yui');
    await openPalette(page);
    await expect(page.getByRole('button', { name: 'タスクを追加' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '家計を開く' })).toHaveCount(0);
  });
});

test.describe('theme and density', () => {
  test('stays on the original light theme by default', async ({ page }) => {
    await page.goto('/today');
    expect(await dataset(page, 'theme')).toBe('light');
    expect(await dataset(page, 'density')).toBe('comfortable');
  });

  test('persists across reloads and works before the settings page mounts', async ({ page }) => {
    await page.goto('/settings/accessibility');
    await page.getByLabel('桜').check();
    await page.getByLabel('夜', { exact: true }).check();
    await page.getByLabel('コンパクト').check();
    expect(await dataset(page, 'theme')).toBe('sakura-night');
    await page.goto('/today');
    expect(await dataset(page, 'theme')).toBe('sakura-night');
    expect(await dataset(page, 'density')).toBe('compact');
    await page.goto('/settings/accessibility');
    await expect(page.getByLabel('桜')).toBeChecked();
    await expect(page.getByLabel('コンパクト')).toBeChecked();
  });

  test('system mode follows the device, and the top bar still flips day and night', async ({ page }) => {
    await page.goto('/settings/accessibility');
    await page.getByLabel('抹茶').check();
    await page.getByLabel('端末に合わせる').check();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => dataset(page, 'theme')).toBe('matcha-night');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => dataset(page, 'theme')).toBe('matcha');
    await page.getByRole('button', { name: '暗いテーマに切り替え' }).click();
    await expect.poll(() => dataset(page, 'theme')).toBe('matcha-night');
    await expect(page.getByLabel('夜', { exact: true })).toBeChecked();
  });

  test('keeps a value saved by the earlier version', async ({ page }) => {
    await page.goto('/today');
    await page.evaluate(() => localStorage.setItem('family-hub-theme', 'dusk'));
    await page.reload();
    expect(await dataset(page, 'theme')).toBe('dusk');
  });

  for (const theme of ['warm', 'warm-night', 'modern', 'modern-night', 'matcha', 'matcha-night', 'sakura', 'sakura-night']) {
    test(`axe finds no color problem on Today in ${theme}`, async ({ page }) => {
      await page.goto('/today');
      await page.evaluate((value) => localStorage.setItem('family-hub-theme', value), theme);
      await page.reload();
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')), theme).toEqual([]);
    });
  }

  test('compact keeps controls at the touch size', async ({ page }) => {
    await page.goto('/today');
    await page.evaluate(() => localStorage.setItem('family-hub-density', 'compact'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'すぐに追加' })).toBeVisible();
    const heights = await page.locator('main button:visible, main a.button:visible, main select:visible').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  });
});

test('the app reduced-motion setting applies right after a reload', async ({ page }) => {
  await page.goto('/today');
  await page.evaluate(() => localStorage.setItem('family-hub-reduced-motion', 'true'));
  await page.reload();
  expect(await dataset(page, 'reduceMotion')).toBe('true');
});

test('season marks are decorative and follow the date', async ({ page }) => {
  await page.goto('/today');
  await expect(page.locator('.page-head .season-mark')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.page-head .season-mark')).toHaveAttribute('data-season', 'autumn');
  await page.goto('/calendar?month=2027-01');
  await expect(page.locator('.calendar-month-heading .season-mark')).toHaveAttribute('data-season', 'winter');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#calendar-month-2027-01 .season-mark')).toHaveAttribute('data-season', 'winter');
});

test.describe('new-version notice', () => {
  test('sample data never asks for the version and shows nothing', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/v1/version')) asked.push(request.url()); });
    await page.goto('/today');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: '読み込み直す' })).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

test.describe('unsaved changes', () => {
  const discardPrompt = (page: Page) => page.getByRole('dialog', { name: '入力中の内容を破棄しますか' });

  test('an untouched form closes without asking', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Escape, close, backdrop and cancel all ask, and staying keeps the input', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
    await dialog.getByLabel('タスク名').fill('まだ保存していない');
    await page.keyboard.press('Escape');
    await expect(discardPrompt(page)).toBeVisible();
    await discardPrompt(page).getByRole('button', { name: '編集に戻る' }).click();
    await expect(dialog.getByLabel('タスク名')).toHaveValue('まだ保存していない');
    await dialog.getByRole('button', { name: '閉じる' }).click();
    await discardPrompt(page).getByRole('button', { name: '編集に戻る' }).click();
    await dialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect(discardPrompt(page)).toBeVisible();
    await discardPrompt(page).getByRole('button', { name: '破棄する' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('switching the kind of a filled form asks first', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
    await dialog.getByLabel('タスク名').fill('途中');
    await dialog.getByRole('button', { name: 'メモ', exact: true }).click();
    await discardPrompt(page).getByRole('button', { name: '編集に戻る' }).click();
    await expect(dialog.getByLabel('タスク名')).toHaveValue('途中');
  });

  for (const [label, kindName, field] of [['event', '予定', '予定名'], ['memo', 'メモ', 'タイトル'], ['expense', '家計', '金額（円）']] as const) {
    test(`the ${label} form asks too`, async ({ page }) => {
      await page.goto('/today');
      await page.getByRole('button', { name: 'すぐに追加' }).click();
      const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
      await dialog.getByRole('button', { name: kindName, exact: true }).click();
      await dialog.getByLabel(field).fill('1200');
      await page.keyboard.press('Escape');
      await expect(discardPrompt(page)).toBeVisible();
      await discardPrompt(page).getByRole('button', { name: '破棄する' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }

  test('the browser back button asks, and discarding finishes the move', async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('link', { name: /小児科の控え/ }).click();
    await page.getByRole('button', { name: '内容を編集' }).click();
    const form = page.getByRole('dialog', { name: 'メモを編集' });
    await form.getByLabel('タイトル').fill('編集の途中');
    await page.goBack();
    await expect(discardPrompt(page)).toBeVisible();
    await expect(page).toHaveURL(/\/notes\/memo-clinic/);
    await discardPrompt(page).getByRole('button', { name: '編集に戻る' }).click();
    await expect(form.getByLabel('タイトル')).toHaveValue('編集の途中');
    await page.goBack();
    await discardPrompt(page).getByRole('button', { name: '破棄する' }).click();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('moving from the palette asks', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.getByRole('dialog', { name: 'すぐに追加' }).getByLabel('タスク名').fill('途中');
    await page.keyboard.press('Control+K');
    await page.getByRole('searchbox').fill('予定を開く');
    await page.getByRole('button', { name: '予定を開く' }).click();
    await expect(discardPrompt(page)).toBeVisible();
    await discardPrompt(page).getByRole('button', { name: '破棄する' }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  });

  test('discarding on the back button also closes a form that outlives the page', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'メモ' }).click();
    await page.getByRole('button', { name: 'メモを追加' }).click();
    await page.getByRole('dialog', { name: 'メモを作る' }).getByLabel('タイトル').fill('途中');
    await page.goBack();
    await discardPrompt(page).getByRole('button', { name: '破棄する' }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'タスク' }).click();
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.getByRole('dialog', { name: 'すぐに追加' }).getByLabel('タスク名').fill('途中');
    await page.goBack();
    await expect(discardPrompt(page)).toBeVisible();
    await discardPrompt(page).getByRole('button', { name: '破棄する' }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a saved form leaves no warning behind', async ({ page }) => {
    await page.goto('/today');
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    const dialog = page.getByRole('dialog', { name: 'すぐに追加' });
    await dialog.getByLabel('タスク名').fill('保存するタスク');
    await dialog.locator('button[type=submit]').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: '予定' }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(discardPrompt(page)).toHaveCount(0);
  });
});

test.describe('two-pane layout', () => {
  for (const [path, title, list] of [['/tasks/todo-form', '就学援助の確認票', '図書館の本を返す'], ['/notes/memo-clinic', '小児科の控え', '学校公開のお知らせ'], ['/budget/expense-books?view=list', '学校教材', '週末の食材']] as const) {
    test(`shows the list beside ${path} on a wide content area`, async ({ page }) => {
      await page.goto(path);
      const pane = page.locator('.detail-pane');
      await expect(pane.getByRole('heading', { name: title })).toBeVisible();
      await expect(page.locator('.detail-main').getByText(list).first()).toBeVisible();
      await expect(page.locator('.drawer')).toHaveCount(0);
      await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
      const [listBox, paneBox] = await Promise.all([page.locator('.detail-main').boundingBox(), pane.boundingBox()]);
      expect(paneBox!.x).toBeGreaterThanOrEqual(listBox!.x + listBox!.width);
      await page.keyboard.press('Escape');
      await expect(pane).toHaveCount(0);
      await expect(page).not.toHaveURL(new RegExp(path.split('?')[0]));
    });

    test(`keeps the drawer for ${path} on a narrow content area`, async ({ page }) => {
      await page.setViewportSize({ width: 800, height: 900 });
      await page.goto(path);
      await expect(page.locator('.drawer').getByRole('heading', { name: title })).toBeVisible();
      await expect(page.locator('.detail-pane')).toHaveCount(0);
      await expect(page.locator('#root')).toHaveAttribute('inert', '');
    });
  }

  test('changing items keeps the place in the list and moves focus into the detail', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.goto('/tasks');
    await page.getByRole('link', { name: /資源ごみをまとめる/ }).click();
    await expect(page.locator('.detail-pane').getByRole('heading', { name: '資源ごみをまとめる' })).toBeVisible();
    await expect(page.locator('.detail-pane').getByRole('button', { name: '閉じる' })).toBeFocused();
    await page.getByRole('link', { name: /音読の記録/ }).click();
    await expect(page.locator('.detail-pane').getByRole('heading', { name: '音読の記録' })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\/todo-practice/);
  });

  test('the pane follows the resized window', async ({ page }) => {
    await page.goto('/tasks/todo-form');
    await expect(page.locator('.detail-pane')).toBeVisible();
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator('.drawer')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator('.detail-pane')).toBeVisible();
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  });
});

test.describe('month keyboard', () => {
  const day = (page: Page, date: string) => page.locator(`button.day[data-date="${date}"]`);

  test('arrows, Home, End, PageUp and PageDown move the selected date', async ({ page }) => {
    await page.goto('/calendar?month=2026-10&on=2026-10-14');
    await day(page, '2026-10-14').focus();
    for (const [key, date] of [['ArrowRight', '2026-10-15'], ['ArrowDown', '2026-10-22'], ['ArrowLeft', '2026-10-21'], ['ArrowUp', '2026-10-14'], ['Home', '2026-10-11'], ['End', '2026-10-17']] as const) {
      await page.keyboard.press(key);
      await expect(day(page, date)).toBeFocused();
      await expect(day(page, date)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.keyboard.press('PageDown');
    await expect(day(page, '2026-11-17')).toBeFocused();
    await expect(page.getByRole('button', { name: /2026年11月/ })).toBeVisible();
    await page.keyboard.press('PageUp');
    await expect(day(page, '2026-10-17')).toBeFocused();
    await expect(page).toHaveURL(/on=2026-10-17/);
  });

  test('the grid is a single tab stop, and the skip link stays first', async ({ page, browserName }) => {
    await page.goto('/calendar?month=2026-10&on=2026-10-14');
    await expect(page.locator('button.day[tabindex="0"]')).toHaveCount(1);
    await expect(day(page, '2026-10-14')).toHaveAttribute('tabindex', '0');
    // Safari の既定では Tab はリンクを飛ばし、Option+Tab で止まる。
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('link', { name: '本文へ移動' })).toBeFocused();
  });
});

test.describe('resync', () => {
  test('shows the last update and succeeds on Today and in settings', async ({ page }) => {
    await page.goto('/today');
    await expect(page.getByText(/最終更新/)).toBeVisible();
    await page.getByRole('button', { name: '今すぐ更新' }).click();
    await expect(page.locator('.toast-visible')).toContainText('最新の内容に更新しました');
    await page.goto('/settings/accessibility');
    await expect(page.getByText(/最終更新/)).toBeVisible();
    await page.getByRole('button', { name: '今すぐ更新' }).click();
    await expect(page.locator('.toast-visible')).toContainText('最新の内容に更新しました');
  });

  test('offers another try after a failure', async ({ page }) => {
    await page.goto('/settings/accessibility?scenario=offline');
    await page.getByRole('button', { name: '今すぐ更新' }).click();
    await expect(page.getByText('更新できませんでした。接続を確認して、もう一度お試しください。')).toBeVisible();
    await expect(page.getByRole('button', { name: 'もう一度更新' })).toBeEnabled();
  });
});

test.describe('family settings', () => {
  const memberRow = (page: Page, name: string) => page.getByRole('button', { name: `${name}さんの権限を設定` });

  test('transfers ownership after a confirmation', async ({ page }) => {
    await page.goto('/settings/household');
    await memberRow(page, '蓮').click();
    await page.getByRole('button', { name: '管理者を渡す' }).click();
    const confirm = page.getByRole('dialog', { name: '蓮さんに管理者を渡しますか' });
    await confirm.getByRole('button', { name: 'キャンセル' }).click();
    await expect(confirm).toHaveCount(0);
    await page.getByRole('button', { name: '管理者を渡す' }).click();
    await page.getByRole('dialog', { name: '蓮さんに管理者を渡しますか' }).getByRole('button', { name: '管理者を渡す' }).click();
    await expect(page.locator('.toast-visible')).toContainText('蓮さんに管理者を渡しました');
    await expect(page.getByRole('button', { name: '家族グループから退出' })).toBeVisible();
  });

  test('offers transfer only for active adults, and nothing for the owner', async ({ page }) => {
    await page.goto('/settings/household');
    await memberRow(page, '花').click();
    await expect(page.getByRole('button', { name: '管理者を渡す' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '家族グループから外す' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
    await memberRow(page, '碧').click();
    await expect(page.getByRole('button', { name: '家族グループから外す' })).toHaveCount(0);
  });

  test('suspends, resumes and removes a member', async ({ page }) => {
    await page.goto('/settings/household');
    await memberRow(page, '結衣').click();
    await page.getByRole('button', { name: '一時停止', exact: true }).click();
    await page.getByRole('button', { name: '一時停止する' }).click();
    await expect(page.locator('.toast-visible')).toContainText('結衣さんを一時停止しました');
    await memberRow(page, '結衣').click();
    await page.getByRole('button', { name: '一時停止を解除' }).click();
    await page.getByRole('button', { name: '解除する' }).click();
    await expect(page.locator('.toast-visible')).toContainText('一時停止を解除しました');
    await memberRow(page, '結衣').click();
    await page.getByRole('button', { name: '家族グループから外す' }).click();
    await page.getByRole('button', { name: '外す', exact: true }).click();
    await expect(page.locator('.toast-visible')).toContainText('結衣さんを家族グループから外しました');
    await expect(memberRow(page, '結衣')).toHaveCount(0);
  });

  test('counts down the renames left and stops at zero', async ({ page }) => {
    await page.goto('/settings/household');
    await expect(page.getByText(/あと3回変更できます/)).toBeVisible();
    for (const [name, left] of [['森家', /あと2回変更できます/], ['森のうち', /あと1回変更できます/]] as const) {
      await page.getByLabel('名前', { exact: true }).fill(name);
      await page.getByRole('button', { name: '名前を保存' }).click();
      await expect(page.getByText(left)).toBeVisible();
    }
    await page.getByLabel('名前', { exact: true }).fill('森の家');
    await page.getByRole('button', { name: '名前を保存' }).click();
    await expect(page.getByText(/名前の変更は24時間で3回までです/)).toBeVisible();
    await expect(page.getByRole('button', { name: '名前を保存' })).toBeDisabled();
  });

  test('shows how many of the eight places are used', async ({ page }) => {
    await page.goto('/settings/household');
    await expect(page.getByText(/利用中 5人 \/ 8人まで/)).toBeVisible();
  });

  test('a non-owner can leave from the household and account tabs', async ({ page }) => {
    await page.goto('/settings/household?actor=member-ren');
    await expect(page.getByRole('button', { name: '家族グループから退出' })).toBeVisible();
    await page.goto('/settings/account?actor=member-hana');
    await page.getByRole('button', { name: '家族グループから退出' }).click();
    await expect(page.getByRole('dialog', { name: '家族グループから退出しますか' })).toBeVisible();
  });

  test('an owner cannot see leave', async ({ page }) => {
    await page.goto('/settings/household');
    await expect(page.getByRole('button', { name: '家族グループから退出' })).toHaveCount(0);
  });

  test('manages color lists, which then appear in forms', async ({ page }) => {
    await page.goto('/settings/household');
    await page.getByRole('button', { name: 'リストを追加' }).click();
    const form = page.getByRole('dialog', { name: 'リストを追加' });
    await form.getByRole('button', { name: '保存する' }).click();
    await expect(form.getByRole('alert')).toContainText('リストの名前');
    await form.getByLabel('名前').fill('病院');
    await form.getByLabel('桃').check();
    await form.getByRole('button', { name: '保存する' }).click();
    await expect(page.locator('.toast-visible')).toContainText('リスト「病院」を保存しました');
    await page.getByRole('button', { name: 'リスト「病院」を編集' }).click();
    await page.getByRole('dialog', { name: 'リストを編集' }).getByLabel('名前').fill('通院');
    await page.getByRole('dialog', { name: 'リストを編集' }).getByRole('button', { name: '保存する' }).click();
    await expect(page.locator('.toast-visible')).toContainText('リスト「通院」を保存しました');
    await page.getByRole('button', { name: 'リスト「通院」を削除' }).click();
    await page.getByRole('dialog', { name: 'リスト「通院」を削除しますか' }).getByRole('button', { name: '削除' }).click();
    await expect(page.getByRole('button', { name: 'リスト「通院」を編集' })).toHaveCount(0);
  });
});

test.describe('recently deleted', () => {
  test('lists the kind, name, date and days left, and restores', async ({ page }) => {
    await page.goto('/notes/memo-school');
    await page.getByRole('button', { name: 'メモを削除' }).click();
    await page.getByRole('dialog', { name: 'メモを削除しますか' }).getByRole('button', { name: '削除' }).click();
    await expect(page.locator('.toast-visible')).toContainText('削除しました');
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: '設定' }).click();
    await page.getByRole('link', { name: '最近削除', exact: true }).click();
    const row = page.getByRole('listitem').filter({ hasText: '学校公開のお知らせ' });
    await expect(row).toContainText('メモ');
    await expect(row).toContainText('あと7日');
    await expect(row).toContainText('に削除');
    await row.getByRole('button', { name: '「学校公開のお知らせ」を元に戻す' }).click();
    await expect(page.locator('.toast-visible')).toContainText('元に戻しました');
    await expect(page.getByText('最近削除したものはありません')).toBeVisible();
    await page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'メモ' }).click();
    await expect(page.getByRole('heading', { name: '学校公開のお知らせ' })).toBeVisible();
  });
});

test.describe('help', () => {
  test('searches through the URL and announces the count', async ({ page }) => {
    await page.goto('/settings/help');
    await expect(page.getByRole('status').filter({ hasText: '件の質問' })).toBeVisible();
    await page.getByLabel('ヘルプを検索').fill('heic');
    await expect(page).toHaveURL(/q=heic/);
    await expect(page.getByRole('status').filter({ hasText: '1件の質問' })).toBeVisible();
    await expect(page.getByText('アルバムに HEIC の写真を追加できません')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('ヘルプを検索')).toHaveValue('heic');
    await expect(page.getByRole('status').filter({ hasText: '1件の質問' })).toBeVisible();
  });

  test('filters by category and shows a zero-result state that can be cleared', async ({ page }) => {
    await page.goto('/settings/help?q=%E5%86%99%E7%9C%9F');
    await page.getByRole('button', { name: '家族と共有' }).click();
    await expect(page).toHaveURL(/category=family/);
    await expect(page.getByText('一致する質問はありません')).toBeVisible();
    await page.getByRole('button', { name: '条件を消す' }).click();
    await expect(page.getByLabel('ヘルプを検索')).toHaveValue('');
    await expect(page.locator('.help-item').first()).toBeVisible();
  });

  test('a deep link opens the question, and opening one writes the link', async ({ page }) => {
    await page.goto('/settings/help?item=recently-deleted');
    await expect(page.locator('#help-recently-deleted')).toHaveAttribute('open', '');
    await expect(page.getByText('削除から7日以内なら')).toBeVisible();
    await page.getByText('家族を招待するには？').click();
    await expect(page).toHaveURL(/item=invite-family/);
    await expect(page.locator('#help-invite-family')).toHaveAttribute('open', '');
    await expect(page.locator('#help-recently-deleted')).not.toHaveAttribute('open', '');
  });
});

test.describe('legal', () => {
  test('renders both drafts from data, clearly marked', async ({ page }) => {
    await page.goto('/settings/legal');
    await expect(page.getByRole('heading', { name: '利用規約（草案）' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'プライバシーポリシー（草案）' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('草案');
    await expect(page.locator('mark.legal-placeholder').first()).toContainText('運営者名');
    await expect(page.getByText(/OpenPOI：/)).toBeVisible();
    await expect(page.getByText(/Open-Meteo：/)).toBeVisible();
    await expect(page.getByText(/削除から30日を過ぎた記録は/)).toBeVisible();
  });

  test('is linked from sign-up without leaving the form', async ({ page }) => {
    await page.goto('/sign-up');
    const link = page.getByRole('link', { name: /利用規約とプライバシーポリシーの草案/ });
    await expect(link).toHaveAttribute('href', '/settings/legal');
    await expect(link).toHaveAttribute('target', '_blank');
  });
});

test.describe('privacy settings on this device', () => {
  const hide = (page: Page, state: 'hidden' | 'visible') => page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
  const rootFilter = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('root')!).filter);

  test('blurs the app only while the tab is hidden, and only when turned on', async ({ page }) => {
    await page.goto('/settings/privacy');
    await hide(page, 'hidden');
    expect(await rootFilter(page)).toBe('none');
    await hide(page, 'visible');
    const toggle = page.getByRole('button', { name: '隠れている間は画面をぼかす' });
    await expect(page.getByText('アプリの切り替え画面に映る内容まで隠せるとは限りません。')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await hide(page, 'hidden');
    expect(await rootFilter(page)).toContain('blur');
    await hide(page, 'visible');
    expect(await rootFilter(page)).toBe('none');
    await page.reload();
    await hide(page, 'hidden');
    expect(await rootFilter(page)).toContain('blur');
  });

  test('blur also covers an open dialog', async ({ page }) => {
    await page.goto('/today');
    await page.evaluate(() => localStorage.setItem('family-hub-privacy-blur', 'true'));
    await page.reload();
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await hide(page, 'hidden');
    const filter = await page.locator('[data-modal-root]').evaluate((element) => getComputedStyle(element).filter);
    expect(filter).toContain('blur');
  });

  test('the photo location default feeds the album upload toggle', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: /写真や動画を追加/ }).first().click();
    await expect(page.getByLabel('撮影場所を残す')).not.toBeChecked();
    await page.goto('/settings/privacy');
    await page.getByRole('button', { name: '写真の撮影場所を残す' }).click();
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: /写真や動画を追加/ }).first().click();
    await expect(page.getByLabel('撮影場所を残す')).toBeChecked();
  });
});
