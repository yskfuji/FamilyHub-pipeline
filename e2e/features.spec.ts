import { expect, test, type Page } from './fixtures';

/**
 * 段階9の新しい画面（docs/acceptance/criteria.md の A3〜A5、A12〜A15、A17 の画面と E2E）。
 * 試験の名前の先頭の ID（S9-…）を criteria.md から引く。
 */

const yen = (amount: string) => `[¥￥]${amount}`;
const toast = (page: Page) => page.locator('.toast-visible');
const openSearch = async (page: Page) => {
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Control+K');
  await expect(page.getByRole('searchbox')).toBeFocused();
};
const searchOrder = ['予定', 'タスク', 'メモ', '家計', '場所', '関連リンク', 'アルバム', '写真・動画'];

test.describe('S9-AUDIT change record (A5-8)', () => {
  test('S9-AUDIT-1 an owner sees the record by day, the chain check, hidden targets without an id, and more on request', async ({ page }) => {
    await page.goto('/settings/household');
    await page.getByRole('link', { name: '変更の記録' }).click();
    await expect(page).toHaveURL(/\/settings\/audit$/);
    await expect(page.getByRole('heading', { level: 1, name: '変更の記録' })).toBeVisible();
    const chain = page.getByRole('region', { name: '改ざんの確認' });
    await expect(chain).toContainText('記録の改ざんは見つかっていません');
    await expect(chain).toContainText(/最後に確かめた日時：9月30日/);
    await expect(page.getByRole('heading', { name: /^9月30日\(水\)/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^9月29日\(火\)/ })).toBeVisible();
    // 碧さんには見えない蓮さんの支出を指す行は、ID を伏せて「見られない記録」になる。
    await expect(page.getByText('見られない記録').first()).toBeVisible();
    expect(await page.locator('main').innerHTML()).not.toMatch(/expense-ren-(private|deleted)/);
    await expect(page.locator('.audit-row')).toHaveCount(20);
    await page.getByRole('button', { name: 'もっと見る' }).click();
    await expect(page.locator('.audit-row')).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'もっと見る' })).toHaveCount(0);
    await expect(page.getByText('運営者が利用期間を延ばした')).toBeVisible();
  });

  test('S9-AUDIT-2 filters by person, kind and period live in the URL, with an empty state', async ({ page }) => {
    await page.goto('/settings/audit');
    await page.getByLabel('人', { exact: true }).selectOption('member-ren');
    await expect(page).toHaveURL(/\?who=member-ren$/);
    await expect(page.locator('.audit-meta')).not.toHaveCount(0);
    for (const meta of await page.locator('.audit-meta').allInnerTexts()) expect(meta).toContain('蓮さん');
    await page.getByLabel('種類', { exact: true }).selectOption('expenses');
    await expect(page).toHaveURL(/who=member-ren&kind=expenses/);
    await expect(page.locator('.audit-row strong')).toHaveText(['家計の記録を削除した', '精算を記録した', '家計の記録を追加した', '家計の記録を追加した']);
    await page.getByLabel('期間', { exact: true }).selectOption('today');
    await expect(page.getByRole('heading', { name: 'この条件の記録はありません' })).toBeVisible();
    // 戻すと元の一覧へ。URL から開いても同じ絞り込みになる。
    await page.goto('/settings/audit?kind=albums&period=week');
    await expect(page.getByLabel('種類', { exact: true })).toHaveValue('albums');
    await expect(page.locator('.audit-row strong')).toHaveText(['アルバムを変えた']);
  });

  test('S9-AUDIT-3 a change made now appears at the top, and "my activity" lists my own account record', async ({ page }) => {
    await page.goto('/settings/notifications');
    await page.getByRole('button', { name: 'タスクの期限を通知' }).click();
    await expect(toast(page)).toContainText('通知設定を保存しました');
    await page.getByRole('link', { name: '変更の記録' }).click();
    await expect(page.locator('.audit-row').first()).toContainText('通知の設定を変えた');
    await expect(page.locator('.audit-row').first()).toContainText('碧さん');
    await page.getByRole('button', { name: '自分の操作' }).click();
    await expect(page).toHaveURL(/view=mine/);
    await expect(page.getByRole('heading', { name: '自分の操作の記録' })).toBeVisible();
    await expect(page.locator('.audit-row strong')).toHaveText(['パスキーでサインインした', 'パスキーを登録した', 'パスワードでサインインした']);
  });

  for (const [actor, role] of [['member-ren', 'adult'], ['member-hana', 'child']] as const) {
    test(`S9-AUDIT-4 ${role}: no entry point, and a deep link is refused`, async ({ page }) => {
      await page.goto(`/settings/security?actor=${actor}`);
      await expect(page.getByRole('navigation', { name: '設定項目' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '設定項目' }).getByRole('link', { name: '変更の記録' })).toHaveCount(0);
      // 自分の操作の記録は、どの人もサインインとセキュリティで見られる（UC-A15）。
      await expect(page.getByRole('heading', { name: '自分の操作の記録' })).toBeVisible();
      await page.goto(`/settings/audit?actor=${actor}`);
      await expect(page.getByRole('heading', { name: 'このページは表示できません' })).toBeVisible();
      await expect(page.locator('.audit-row')).toHaveCount(0);
    });
  }
});

test.describe('S9-KIND changing the kind of a record (A3-5)', () => {
  test('S9-KIND-1 an expense becomes income: categories switch in place and the lost shares are named before saving', async ({ page }) => {
    await page.goto('/budget/expense-books');
    await page.getByRole('dialog', { name: '学校教材' }).getByRole('button', { name: '内容を編集' }).click();
    const edit = page.getByRole('dialog', { name: '支出を編集' });
    await expect(edit.getByRole('radio', { name: '支出' })).toBeChecked();
    await expect(edit.getByLabel('費目').locator('option')).toHaveCount(11);
    await edit.getByRole('radio', { name: '収入' }).check();
    await expect(edit.getByRole('status').filter({ hasText: '負担の記録' })).toHaveText(new RegExp(`負担の記録（蓮さん ${yen('1,430')}）は消えます`));
    await expect(edit.getByLabel('費目').locator('option')).toHaveCount(6);
    await expect(edit.getByLabel('費目')).toHaveValue('income_other');
    await expect(edit.getByText('負担の分け方')).toHaveCount(0);
    await edit.getByRole('button', { name: '変更を保存' }).click();
    await expect(toast(page)).toContainText('「学校教材」を収入に変えました');
    const detail = page.getByRole('dialog', { name: '学校教材' });
    await expect(detail.locator('.detail-list')).toContainText('収入');
    await expect(detail.getByRole('table')).toHaveCount(0);
  });

  test('S9-KIND-2 income becomes an expense: shares appear in place with a spending category', async ({ page }) => {
    await page.goto('/budget/income-salary');
    await page.getByRole('dialog', { name: '9月の給与' }).getByRole('button', { name: '内容を編集' }).click();
    const edit = page.getByRole('dialog', { name: '収入を編集' });
    await edit.getByRole('radio', { name: '支出' }).check();
    await expect(edit.getByRole('status').filter({ hasText: '負担する人' })).toBeVisible();
    await expect(edit.getByText('負担の分け方')).toBeVisible();
    await expect(edit.getByLabel('費目')).toHaveValue('other');
    await edit.getByLabel('費目').selectOption('home');
    await edit.getByRole('button', { name: '変更を保存' }).click();
    await expect(toast(page)).toContainText('「9月の給与」を支出に変えました');
    await expect(page.getByRole('dialog', { name: '9月の給与' }).getByRole('table')).toContainText('蓮');
  });

  test('S9-KIND-3 a live settlement: the API refuses with its reason and nothing changes', async ({ page }) => {
    await page.goto('/budget/expense-groceries');
    await page.getByRole('dialog', { name: '週末の食材' }).getByRole('button', { name: '内容を編集' }).click();
    const edit = page.getByRole('dialog', { name: '支出を編集' });
    await edit.getByRole('radio', { name: '収入' }).check();
    await expect(edit.getByRole('status').filter({ hasText: '取り消していない精算があります' })).toBeVisible();
    await edit.getByRole('button', { name: '変更を保存' }).click();
    await expect(edit.getByRole('alert')).toHaveText('取り消していない精算があるため、収入に変えられません。先に精算を取り消してください。');
    await expect(edit.getByRole('radio', { name: '収入' })).toBeChecked();
    await edit.getByRole('button', { name: 'キャンセル' }).click();
    await page.getByRole('button', { name: '破棄する' }).click();
    await expect(page.getByRole('dialog', { name: '週末の食材' }).locator('.detail-list')).toContainText('支出');
  });
});

test.describe('S9-SETTLE settling everything at once (A4-3, 4, 6, 8)', () => {
  test('S9-SETTLE-1 settles the shown shares in one record, shows it as one history row, and reverses it as a whole', async ({ page }) => {
    await page.goto('/budget?view=settlements&actor=member-ren');
    await page.getByRole('button', { name: 'まとめて精算する' }).click();
    const dialog = page.getByRole('dialog', { name: 'まとめて精算しますか' });
    await expect(dialog).toContainText('残りのある負担3件');
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    await expect(dialog.getByRole('listitem')).toContainText('碧さんから蓮さんへ');
    await expect(dialog.getByRole('listitem')).toContainText(new RegExp(yen('1,250')));
    await expect(dialog).toContainText('含める記録：3件');
    await dialog.getByRole('button', { name: '精算を記録する' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: '3件の負担をまとめて精算しました' }).first()).toBeVisible();
    await expect(page.getByText('すべて精算済みです')).toBeVisible();
    const history = page.getByRole('region', { name: '精算の履歴' });
    const batch = history.locator('.batch-row');
    await expect(batch).toHaveCount(1);
    await expect(batch).toContainText('まとめて精算（3件）');
    await expect(batch).toContainText(new RegExp(`碧さんから蓮さんへ ${yen('1,250')}`));
    // まとめに含めた記録は、1件ずつの行としては並ばない。
    await expect(history.locator('.list-row:not(.batch-row)')).toHaveCount(2);
    await batch.getByRole('button', { name: /まとめて取り消す/ }).click();
    await expect(toast(page)).toContainText('まとめた精算を取り消しました');
    await expect(history.locator('.batch-row')).toHaveCount(2);
    await expect(history.locator('.batch-row').filter({ hasText: 'まとめた精算の取り消し' })).toContainText('まとめた精算の取り消し（3件）');
    await expect(history.getByText('まとめて取り消し済み')).toBeVisible();
    await expect(page.getByText('残りのある記録3件')).toBeVisible();
  });

  test('S9-SETTLE-2 the button is hidden while a member filter other than "all" is active', async ({ page }) => {
    await page.goto('/budget?view=settlements');
    await expect(page.getByRole('button', { name: 'まとめて精算する' })).toBeVisible();
    await page.getByLabel('表示する人').selectOption({ label: '蓮' });
    await expect(page.getByRole('button', { name: 'まとめて精算する' })).toHaveCount(0);
    await expect(page.getByText('表示する人を「すべて」にすると、まとめて精算できます。')).toBeVisible();
    await page.getByLabel('表示する人').selectOption({ label: 'すべて' });
    await expect(page.getByRole('button', { name: 'まとめて精算する' })).toBeVisible();
  });

  test('S9-SETTLE-3 a refusal is said in plain words, records nothing, and offers only closing', async ({ page }) => {
    // 碧さんには見えない蓮さんの支出の残りがあるので、まとめては記録できない（理由は記録を明かさない文）。
    await page.goto('/budget?view=settlements');
    await page.getByRole('button', { name: 'まとめて精算する' }).click();
    const dialog = page.getByRole('dialog', { name: 'まとめて精算しますか' });
    await expect(dialog.getByRole('listitem')).toContainText(new RegExp(yen('250')));
    await dialog.getByRole('button', { name: '精算を記録する' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('まとめて精算できませんでした。精算は1件ずつ記録してください。');
    await expect(dialog.getByRole('button', { name: '精算を記録する' })).toHaveCount(0);
    await dialog.getByRole('button', { name: '閉じる' }).last().click();
    await expect(page.getByRole('region', { name: '精算の履歴' }).locator('.batch-row')).toHaveCount(0);
  });
});

test.describe('S9-VIEW attachments open inside the app (A14)', () => {
  test('S9-VIEW-1 an image opens in the viewer and closing returns focus to the opener', async ({ page }) => {
    await page.goto('/notes/memo-receipt');
    const opener = page.getByRole('button', { name: '教材の写真.jpgを開く', exact: true });
    await opener.click();
    const viewer = page.getByRole('dialog', { name: '「教材の写真.jpg」を表示' });
    await expect(viewer.getByRole('img', { name: '教材の写真.jpg' })).toBeVisible();
    await expect.poll(() => viewer.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('S9-VIEW-2 an mp4 plays in the viewer, and the close button returns focus', async ({ page }) => {
    await page.goto('/notes/memo-receipt');
    const opener = page.getByRole('button', { name: '教材の使い方.mp4を開く', exact: true });
    await opener.click();
    const viewer = page.getByRole('dialog', { name: '「教材の使い方.mp4」を表示' });
    await expect(viewer.locator('video')).toBeVisible();
    await expect.poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(1);
    expect(await viewer.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    await viewer.getByRole('button', { name: '閉じる' }).click();
    await expect(opener).toBeFocused();
  });

  test('S9-VIEW-3 a CID-font Japanese PDF renders with same-origin CMaps, and its link opens with noopener noreferrer', async ({ page, browserName }) => {
    const resources: string[] = [];
    page.on('response', (response) => { if (response.url().includes('/pdfjs/')) resources.push(`${response.status()} ${new URL(response.url()).origin === new URL(page.url()).origin ? 'same' : 'other'} ${new URL(response.url()).pathname}`); });
    await page.goto('/notes/memo-school');
    await page.getByRole('button', { name: '学校公開.pdfを開く', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: '「学校公開.pdf」を表示' });
    await expect(viewer.locator('.pdf-page[data-drawn="true"]')).toHaveCount(1, { timeout: 15_000 });
    // CMap を読めたときだけ、CID の符号を日本語の文字に戻せる。
    await expect(viewer.locator('figcaption')).toContainText('学校公開のお知らせ（見本）');
    // worker からの読み込みが見えるのは Chromium だけなので、ほかでは同じ URL を直接確かめる。
    if (browserName === 'chromium') expect(resources).toContain('200 same /pdfjs/cmaps/UniJIS-UCS2-H.bcmap');
    // 配信の側は、ないファイルにも index.html を 200 で返すので、中身で確かめる。
    const cmap = await page.request.get('/pdfjs/cmaps/UniJIS-UCS2-H.bcmap');
    expect(cmap.status()).toBe(200);
    expect(cmap.headers()['content-type']).not.toContain('text/html');
    // 描いた canvas に、紙の白でない画素がある。
    expect(await viewer.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0; for (let index = 0; index < data.length; index += 4) if (data[index] < 128) ink += 1; return ink;
    })).toBeGreaterThan(500);
    const link = viewer.getByRole('link', { name: /PDFの中のリンク/ });
    await expect(link).toHaveAttribute('href', 'https://example.com/family-hub/school');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    // 標準の書体も同じオリジンから配る。
    const font = await page.request.get('/pdfjs/standard_fonts/LiberationSans-Regular.ttf');
    expect(font.status()).toBe(200);
    expect([...(await font.body()).subarray(0, 4)]).toEqual([0, 1, 0, 0]);
  });

  test('S9-VIEW-4 the PDF still renders when WebAssembly is unavailable in the page and in the worker', async ({ page }) => {
    await page.addInitScript(() => { Reflect.deleteProperty(globalThis, 'WebAssembly'); });
    // worker のスクリプトの先頭でも WebAssembly を消す（pdf.js の JavaScript の代わりの道だけで描く）。
    let patched = false;
    await page.context().route(/\/assets\/pdf\.worker[^/]*\.js$/, async (route) => {
      patched = true;
      const response = await route.fetch();
      await route.fulfill({ response, body: `Reflect.deleteProperty(globalThis, 'WebAssembly');\n${await response.text()}` });
    });
    await page.goto('/notes/memo-school');
    expect(await page.evaluate(() => typeof (globalThis as { WebAssembly?: unknown }).WebAssembly)).toBe('undefined');
    await page.getByRole('button', { name: '学校公開.pdfを開く', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: '「学校公開.pdf」を表示' });
    await expect(viewer.locator('.pdf-page[data-drawn="true"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(viewer.locator('figcaption')).toContainText('撮影は教室の外だけでお願いします。');
    expect(patched).toBe(true);
  });

  test('S9-VIEW-5 saving is a separate button that downloads the file without opening a window', async ({ page }) => {
    await page.goto('/notes/memo-school');
    await page.evaluate(() => { window.open = () => { document.body.dataset.windowOpened = 'true'; return null; }; });
    await page.getByRole('button', { name: '学校公開.pdfを開く', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: '「学校公開.pdf」を表示' });
    const download = page.waitForEvent('download');
    await viewer.getByRole('button', { name: '学校公開.pdfを端末に保存' }).click();
    expect((await download).suggestedFilename()).toBe('学校公開.pdf');
    await expect(page.locator('body')).not.toHaveAttribute('data-window-opened', 'true');
  });
});

test.describe('S9-SEARCH grouped results (A17-5)', () => {
  test('S9-SEARCH-1 results sit under one heading per kind, and the arrow keys move across groups', async ({ page }) => {
    await page.goto('/today');
    await openSearch(page);
    await page.getByRole('searchbox').fill('学校');
    const panel = page.getByRole('dialog', { name: '家族の情報を検索' });
    await expect(panel.getByRole('heading', { name: /^アルバム/ })).toBeVisible();
    const headings = (await panel.locator('.search-group .palette-heading').allInnerTexts()).map((text) => text.replace(/\d+件$/, ''));
    // 見出しは種類ごとに1つで、決まった順に並ぶ。
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).toEqual([...headings].sort((a, b) => searchOrder.indexOf(a) - searchOrder.indexOf(b)));
    expect(headings).toEqual(expect.arrayContaining(['予定', 'メモ', '家計', 'アルバム']));
    await expect(panel.getByRole('region', { name: /^アルバム/ }).getByRole('link', { name: 'アルバム「運動会」を開く' })).toBeVisible();
    const items = panel.locator('[data-palette-item]');
    await page.keyboard.press('ArrowDown');
    await expect(items.first()).toBeFocused();
    const firstOfSecondGroup = panel.getByRole('region', { name: /^メモ/ }).locator('[data-palette-item]').first();
    const inFirstGroup = await panel.getByRole('region', { name: /^予定/ }).locator('[data-palette-item]').count();
    for (let step = 0; step < inFirstGroup; step += 1) await page.keyboard.press('ArrowDown');
    await expect(firstOfSecondGroup).toBeFocused();
    await page.keyboard.press('End');
    await expect(panel.getByRole('link', { name: 'アルバム「運動会」を開く' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/albums\/album-sports$/);
  });

  test('S9-SEARCH-2 a photo opens the viewer, closing drops ?item= without a history entry, and back does not reopen it', async ({ page }) => {
    await page.goto('/today');
    await openSearch(page);
    await page.getByRole('searchbox').fill('item-sports-2');
    await page.getByRole('link', { name: '写真・動画「item-sports-2.jpg」を開く' }).click();
    await expect(page).toHaveURL(/\/albums\/album-sports\?item=item-sports-2$/);
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    await expect(viewer.locator('.media-count')).toHaveText('item-sports-2.jpg 2 / 3');
    await viewer.getByRole('button', { name: '閉じる' }).click();
    await expect(viewer).toHaveCount(0);
    await expect(page).toHaveURL(/\/albums\/album-sports$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole('dialog', { name: '写真を表示' })).toHaveCount(0);
  });
});

test.describe('S9-LEAVE an owner leaving (A12-1)', () => {
  test('S9-LEAVE-1 the only owner sees why, and a way to hand over first', async ({ page }) => {
    await page.goto('/settings/household');
    const section = page.getByRole('region', { name: '家族グループから退出' });
    await expect(section).toContainText('ただ1人の管理者');
    await expect(section.getByRole('button', { name: '家族グループから退出' })).toHaveCount(0);
    await section.getByRole('link', { name: '管理者を引き継ぐ' }).click();
    await expect(page).toHaveURL(/#household-members$/);
    await expect(page.getByRole('button', { name: '蓮さんの権限を設定' })).toBeInViewport();
  });

  test('S9-LEAVE-2 with another active owner, the confirmation says what happens and the owner leaves', async ({ page }) => {
    await page.goto('/settings/household?household=two-owners');
    const section = page.getByRole('region', { name: '家族グループから退出' });
    await expect(section).toContainText('ほかに管理者（蓮さん）がいるので、退出できます');
    await section.getByRole('button', { name: '家族グループから退出' }).click();
    const dialog = page.getByRole('dialog', { name: '家族グループから退出しますか' });
    await expect(dialog).toContainText('管理者の役割は外れ、蓮さんが管理者として残ります');
    await dialog.getByRole('button', { name: '退出する' }).click();
    await expect(page).toHaveURL(/\/welcome$/);
  });
});

test.describe('S9-SERIES moving a whole series (A13-6)', () => {
  test('S9-SERIES-1 a date change for "all events" says how the series moves before saving', async ({ page }) => {
    await page.goto('/calendar/event-clean?month=2026-10&on=2026-10-15');
    const drawer = page.getByRole('dialog', { name: '資源回収' });
    await drawer.getByLabel('対象とする予定').selectOption('series');
    await drawer.getByRole('button', { name: '編集する' }).click();
    const edit = page.getByRole('dialog', { name: '予定を編集' });
    await expect(edit.locator('[data-series-preview]')).toHaveCount(0);
    await edit.getByLabel('開始', { exact: true }).fill('2026-10-16T08:00');
    await expect(edit.locator('[data-series-preview="shift"]')).toHaveText('すべての予定を1日後へ移します（毎週金曜）');
    await expect(edit.getByRole('button', { name: '変更を保存' })).toBeEnabled();
    await edit.getByLabel('開始', { exact: true }).fill('2026-10-13T08:00');
    await expect(edit.locator('[data-series-preview="shift"]')).toHaveText('すべての予定を2日前へ移します（毎週火曜）');
  });

  test('S9-SERIES-2 a rule that cannot move gives the reason and points to "this and following"', async ({ page }) => {
    await page.goto('/calendar/event-clean?month=2026-10&on=2026-10-01');
    const drawer = page.getByRole('dialog', { name: '資源回収' });
    await drawer.getByLabel('対象とする予定').selectOption('series');
    await drawer.getByRole('button', { name: '編集する' }).click();
    let edit = page.getByRole('dialog', { name: '予定を編集' });
    await edit.getByLabel('繰り返し', { exact: true }).selectOption('monthly');
    await edit.getByRole('button', { name: '変更を保存' }).click();
    await expect(toast(page)).toContainText('更新しました');
    await drawer.getByLabel('対象とする予定').selectOption('series');
    await drawer.getByRole('button', { name: '編集する' }).click();
    edit = page.getByRole('dialog', { name: '予定を編集' });
    // 毎月1日を1日前へ動かすと、30日・31日のない月があるので、すべての回を同じ日数だけ移せない。
    await edit.getByLabel('開始', { exact: true }).fill('2026-09-30T08:00');
    const refused = edit.locator('[data-series-preview="refused"]');
    await expect(refused).toContainText('1〜28日に収まらないため');
    await expect(refused).toContainText('「これ以降の予定」にしてください');
    await expect(edit.getByRole('button', { name: '変更を保存' })).toBeDisabled();
    await refused.getByRole('button', { name: '「これ以降の予定」に切り替える' }).click();
    await expect(edit).toContainText('変更する範囲：これ以降の予定');
    await expect(edit.locator('[data-series-preview]')).toHaveCount(0);
    await expect(edit.getByRole('button', { name: '変更を保存' })).toBeEnabled();
  });
});

test.describe('S9-TAKEN capture time (A15-5)', () => {
  test('S9-TAKEN-1 the viewer shows the capture date and time, and says where a guessed one came from', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '写真「item-sports-1.jpg」を開く' }).click();
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    await expect(viewer.locator('.media-taken')).toHaveText('撮影 2026年9月20日 9:12');
    await viewer.getByRole('button', { name: '次の項目' }).click();
    // 時差の記録がない写真は、家族の時間帯とみなした時刻（推定）。
    await expect(viewer.locator('.media-taken')).toHaveText('撮影 2026年9月20日 10:05（推定）');
    await viewer.getByRole('button', { name: '詳しい情報' }).click();
    const info = viewer.getByRole('complementary', { name: '詳しい情報' });
    await expect(info).toContainText('撮影日時');
    await expect(info).toContainText('写真に時差の記録がないため、日本時間で撮ったものとして表示しています。');
  });

  test('S9-TAKEN-2 "by capture date" sorts oldest first regardless of the album order, and lives in the URL', async ({ page }) => {
    const order = () => page.locator('[data-control-id^="albums.item.open."]').evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-control-id')!.split('.').at(-1)));
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await page.getByRole('button', { name: 'item-sports-3.jpgを前へ移動' }).click();
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await expect.poll(order).toEqual(['item-sports-1', 'item-sports-3', 'item-sports-2']);
    await page.getByRole('button', { name: '撮影日順' }).click();
    await expect(page).toHaveURL(/sort=taken/);
    await expect(page.getByRole('button', { name: '撮影日順' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(order).toEqual(['item-sports-1', 'item-sports-2', 'item-sports-3']);
    await expect(page.getByText('撮影日時の分からない写真や動画は、最後に並べます。')).toBeVisible();
    await page.getByRole('button', { name: 'アルバムの順' }).click();
    await expect.poll(order).toEqual(['item-sports-1', 'item-sports-3', 'item-sports-2']);
  });
});
