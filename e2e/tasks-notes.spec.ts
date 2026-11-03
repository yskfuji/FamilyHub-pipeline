import { expect, test } from './fixtures';
import type { Page } from './fixtures';

const pdf = { name: 'notice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 mock') };
const filter = (page: Page) => page.getByRole('group', { name: 'タスクの絞り込み' });
const toast = (page: Page) => page.locator('.toast-visible');
const column = (page: Page, name: string) => page.locator('.task-column').filter({ has: page.getByRole('heading', { name, exact: true }) });

test.describe('tasks', () => {
  test('filters show counts, live in the URL, and survive opening a task', async ({ page }) => {
    await page.goto('/tasks');
    await expect(filter(page).getByRole('button')).toHaveText(['未完了 4', '自分の担当 2', '確認待ち 1', '完了 1']);
    await expect(page.getByRole('heading', { name: '完了', exact: true })).toHaveCount(0);

    await filter(page).getByRole('button', { name: /自分の担当/ }).click();
    await expect(page).toHaveURL(/\/tasks\?filter=mine$/);
    await expect(page.getByRole('link', { name: /音読の記録/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /図書館の本を返す/ })).toBeVisible();

    await filter(page).getByRole('button', { name: /^完了/ }).click();
    await expect(page).toHaveURL(/\?filter=done$/);
    await page.getByRole('link', { name: /給食費の口座確認/ }).click();
    await expect(page).toHaveURL(/\/tasks\/todo-done\?filter=done$/);
    await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();
    await expect(page).toHaveURL(/\/tasks\?filter=done$/);
    await page.reload();
    await expect(filter(page).getByRole('button', { name: /^完了/ })).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/tasks?filter=all');
    await expect(filter(page).getByRole('button', { name: /未完了/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('cards are sorted by due date within a column', async ({ page }) => {
    await page.goto('/tasks');
    await expect(column(page, '未着手').locator('strong')).toHaveText(['音読の記録', '資源ごみをまとめる']);
  });

  test('the next action depends on who is looking, and the review flow is only guidance', async ({ page }) => {
    await page.goto('/tasks/todo-form?actor=member-ren');
    let drawer = page.getByRole('dialog', { name: '就学援助の確認票' });
    await expect(drawer.getByRole('button', { name: '確認して完了にする' })).toHaveClass(/primary/);

    await page.goto('/tasks/todo-form');
    drawer = page.getByRole('dialog', { name: '就学援助の確認票' });
    await expect(drawer.getByText('蓮さんの確認を待っています。')).toBeVisible();
    await expect(drawer.getByRole('button', { name: '確認して完了にする' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: '完了にする' })).not.toHaveClass(/primary/);
    await expect(drawer.getByRole('button', { name: '進行中に戻す' })).toBeVisible();

    await page.goto('/tasks/todo-practice?actor=member-hana');
    drawer = page.getByRole('dialog', { name: '音読の記録' });
    await expect(drawer.getByRole('button', { name: '確認を依頼する' })).toHaveClass(/primary/);
    await expect(drawer.getByRole('button', { name: '完了にする' })).toBeVisible();
  });

  test('a guest sees no status actions', async ({ page }) => {
    await page.goto('/tasks?actor=member-yui');
    await expect(page.locator('.task-check')).toHaveCount(0);
  });

  test('the list completes a task in place and keeps to the same flow', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('button', { name: /就学援助の確認票/ })).toHaveCount(0);
    await page.getByRole('button', { name: '「図書館の本を返す」を完了にする' }).click();
    await expect(toast(page)).toContainText('「図書館の本を返す」を完了にしました');
    await expect(page.getByRole('link', { name: /図書館の本を返す/ })).toHaveCount(0);
    await expect(filter(page).getByRole('button', { name: /^完了/ })).toHaveText('完了 2');

    await page.goto('/tasks?actor=member-hana');
    await page.getByRole('button', { name: '「音読の記録」の確認を依頼する' }).click();
    await expect(toast(page)).toContainText('確認を依頼しました');
    await expect(column(page, '確認待ち').getByRole('link', { name: /音読の記録/ })).toBeVisible();

    await page.goto('/tasks?actor=member-ren');
    await page.getByRole('button', { name: '「就学援助の確認票」を確認して完了にする' }).click();
    await expect(toast(page)).toContainText('確認して完了にしました');
  });

  test('a one-line comment is kept as the handoff or completion note, and 相手待ち stays a column', async ({ page }) => {
    await page.goto('/tasks/todo-library');
    let drawer = page.getByRole('dialog', { name: '図書館の本を返す' });
    await drawer.getByLabel('一言（任意）').fill('貸出カードを探しています');
    await drawer.getByRole('button', { name: '相手待ちにする' }).click();
    await expect(toast(page)).toContainText('相手待ちにしました');
    await column(page, '相手待ち').getByRole('link', { name: /図書館の本を返す/ }).click();
    drawer = page.getByRole('dialog', { name: '図書館の本を返す' });
    await expect(drawer.getByRole('heading', { name: '引き継ぎの一言' })).toBeVisible();
    await expect(drawer.getByText('貸出カードを探しています')).toBeVisible();

    await drawer.getByLabel('一言（任意）').fill('返却ポストに入れました');
    await drawer.getByRole('button', { name: '完了にする' }).click();
    await expect(toast(page)).toContainText('完了にしました');
    await filter(page).getByRole('button', { name: /^完了/ }).click();
    await page.getByRole('link', { name: /図書館の本を返す/ }).click();
    drawer = page.getByRole('dialog', { name: '図書館の本を返す' });
    await expect(drawer.getByRole('heading', { name: '完了の一言' })).toBeVisible();
    await expect(drawer.getByText('返却ポストに入れました')).toBeVisible();
    await expect(drawer.getByRole('button', { name: '未着手に戻す' })).toHaveClass(/primary/);
  });

  test('the full form creates a task with every field, and offers only active non-guests', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'タスクを追加' }).click();
    const form = page.getByRole('dialog', { name: 'すぐに追加' });
    await expect(form.getByLabel('担当者').locator('option')).toHaveText(['碧', '蓮', '花', '空']);
    await expect(form.getByLabel('確認する人（任意）').locator('option')).toHaveText(['なし', '碧', '蓮', '花', '空']);

    await form.getByLabel('タスク名').fill('遠足の準備');
    await form.getByLabel('メモ（任意）').fill('水筒を洗う');
    await form.getByLabel('開始（任意）').fill('2026-10-02T21:00');
    await form.getByLabel('期限（任意）').fill('2026-10-02T20:00');
    await form.getByRole('button', { name: '追加する' }).click();
    await expect(form.getByRole('alert')).toContainText('期限は開始より後');

    await form.getByLabel('開始（任意）').fill('2026-10-02T09:00');
    await form.getByLabel('担当者').selectOption({ label: '花' });
    await form.getByLabel('確認する人（任意）').selectOption({ label: '蓮' });
    await form.getByLabel('優先度').selectOption('high');
    await form.getByLabel('公開範囲').selectOption('adults');
    await expect(form.getByText('花さんには、この公開範囲だとタスクが表示されません。')).toBeVisible();
    await form.getByLabel('公開範囲').selectOption('participants');
    await expect(form.getByText('作成した本人、担当する人、確認する人に表示します。')).toBeVisible();
    await form.getByLabel('繰り返し', { exact: true }).selectOption('weekly');
    await form.getByRole('radio', { name: '学校' }).check();
    await form.getByRole('button', { name: '追加する' }).click();
    await expect(toast(page)).toContainText('タスクを追加しました');

    await page.getByRole('link', { name: /遠足の準備/ }).click();
    const drawer = page.getByRole('dialog', { name: '遠足の準備' });
    await expect(drawer.getByText(/10月2日.*09:00〜.*10月2日.*20:00/)).toBeVisible();
    await expect(drawer.getByText('優先度：高い')).toBeVisible();
    await expect(drawer.getByText('水筒を洗う')).toBeVisible();
    await expect(drawer.getByText('公開範囲：タスクに関わる人')).toBeVisible();
    await expect(drawer.getByText('学校', { exact: true })).toBeVisible();
    await expect(drawer.getByText('毎週金曜')).toBeVisible();
  });

  test('editing clears fields, and repeating needs a due date', async ({ page }) => {
    await page.goto('/tasks/todo-form');
    await page.getByRole('dialog').getByRole('button', { name: '内容を編集' }).click();
    const form = page.getByRole('dialog', { name: 'タスクを編集' });
    await form.getByLabel('期限（任意）').fill('');
    await form.getByLabel('繰り返し', { exact: true }).selectOption('daily');
    await form.getByRole('button', { name: '変更を保存' }).click();
    await expect(form.getByRole('alert')).toContainText('繰り返すタスクには');
    await form.getByLabel('繰り返し', { exact: true }).selectOption('none');
    await form.getByLabel('確認する人（任意）').selectOption('');
    await form.getByLabel('メモ（任意）').fill('');
    await form.getByRole('button', { name: '変更を保存' }).click();
    await expect(toast(page)).toContainText('更新しました');
    const drawer = page.getByRole('dialog', { name: '就学援助の確認票' });
    await expect(drawer.getByText('期限なし')).toBeVisible();
    await expect(drawer.getByText('なし', { exact: true })).toBeVisible();
    await expect(drawer.getByText('記入済み。提出前の確認をお願いします。')).toHaveCount(0);
  });

  test('a single occurrence cannot change the recurrence', async ({ page }) => {
    await page.goto('/tasks/todo-garbage?actor=member-ren');
    const drawer = page.getByRole('dialog', { name: '資源ごみをまとめる' });
    await page.getByRole('dialog').getByRole('button', { name: '内容を編集' }).click();
    const form = page.getByRole('dialog', { name: 'タスクを編集' });
    await expect(form.getByLabel('繰り返し', { exact: true })).toHaveCount(0);
    await form.getByRole('button', { name: 'キャンセル' }).click();
    await drawer.getByLabel('対象とするタスク').selectOption('series');
    await page.getByRole('dialog').getByRole('button', { name: '内容を編集' }).click();
    await expect(page.getByRole('dialog', { name: 'タスクを編集' }).getByLabel('繰り返し', { exact: true })).toHaveValue('weekly');
  });

  test('delete is hidden from people who are not part of the task', async ({ page }) => {
    await page.goto('/tasks/todo-form?actor=member-ren');
    await expect(page.getByRole('dialog').getByRole('button', { name: '内容を編集' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'タスクを削除' })).toHaveCount(0);
    await page.goto('/tasks/todo-form');
    await expect(page.getByRole('button', { name: 'タスクを削除' })).toBeVisible();
  });

  test('the task form fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'タスクを追加' }).click();
    const form = page.getByRole('dialog', { name: 'すぐに追加' });
    await expect(form.getByLabel('タスク名')).toBeVisible();
    // 開く動き（150ms の移動）の途中では、高さが小数の誤差で 44px をわずかに下回る。動きが終わってから測る。
    await form.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const small = await form.locator('button:visible').evaluateAll((buttons) => buttons.filter((button) => button.getBoundingClientRect().height < 44).length);
    expect(small).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('memos', () => {
  const titles = (page: Page) => page.locator('.memo-card h2');

  test('sorting lives in the URL and survives opening a memo', async ({ page }) => {
    await page.goto('/notes');
    await expect(titles(page)).toHaveText(['教材費レシート', '学校公開のお知らせ', '小児科の控え']);
    await page.getByRole('button', { name: '古い順' }).click();
    await expect(page).toHaveURL(/\/notes\?sort=oldest$/);
    await expect(titles(page)).toHaveText(['小児科の控え', '学校公開のお知らせ', '教材費レシート']);
    await page.getByRole('link', { name: /学校公開のお知らせ/ }).click();
    await expect(page).toHaveURL(/\/notes\/memo-school\?sort=oldest$/);
    await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();
    await expect(page).toHaveURL(/\/notes\?sort=oldest$/);
    await page.reload();
    await expect(titles(page).first()).toHaveText('小児科の控え');
  });

  test('a memo keeps its own date and audience, and the date can be cleared', async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: 'メモを追加' }).click();
    const form = page.getByRole('dialog', { name: 'メモを作る' });
    await expect(form.getByLabel('公開範囲').locator('option')).toHaveText(['大人のメンバーと関わる人', '大人のメンバー', '作成した本人', '選択したメンバー']);
    await form.getByLabel('タイトル').fill('秋の予定');
    await form.getByLabel('本文').fill('バザーの手伝い');
    await form.getByLabel('タグ').fill('学校、今週');
    await form.getByLabel('日付（任意）').fill('2026-11-03');
    await form.getByLabel('公開範囲').selectOption('selected');
    await form.getByRole('button', { name: '作成する' }).click();
    await expect(form.getByRole('alert')).toContainText('公開する人');
    await form.getByRole('group', { name: /公開するメンバー/ }).getByRole('checkbox', { name: '蓮' }).check();
    await form.getByRole('button', { name: '作成する' }).click();
    const drawer = page.getByRole('dialog', { name: '秋の予定' });
    await expect(drawer.getByText(/11月3日/)).toBeVisible();
    await expect(drawer.getByText('共有範囲：選択したメンバー（蓮）')).toBeVisible();

    await drawer.getByRole('button', { name: '閉じる' }).click();
    await expect(titles(page).first()).toHaveText('秋の予定');
    await page.getByRole('link', { name: /秋の予定/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: '内容を編集' }).click();
    const edit = page.getByRole('dialog', { name: 'メモを編集' });
    await expect(edit.getByLabel('日付（任意）')).toHaveValue('2026-11-03');
    await edit.getByLabel('日付（任意）').fill('');
    await edit.getByLabel('公開範囲').selectOption('adults');
    await edit.getByRole('button', { name: '変更を保存' }).click();
    await expect(toast(page)).toContainText('メモを更新しました');
    await expect(page.getByRole('dialog', { name: '秋の予定' }).getByText('共有範囲：大人のメンバー')).toBeVisible();
  });

  test('a child can only choose audiences that stay private', async ({ page }) => {
    await page.goto('/notes?actor=member-hana');
    await page.getByRole('button', { name: 'メモを追加' }).click();
    await expect(page.getByRole('dialog', { name: 'メモを作る' }).getByLabel('公開範囲').locator('option')).toHaveText(['作成した本人', '選択したメンバー']);
  });

  test('uploading shows limits, moves through checking, and the demo opens a sample file of the same type', async ({ page }) => {
    await page.goto('/notes/memo-clinic');
    const drawer = page.getByRole('dialog', { name: '小児科の控え' });
    await expect(drawer.getByText('PDF・JPEG・PNGは10MBまで、MP4は120MBまで添付できます。')).toBeVisible();
    await expect(drawer.getByLabel('添付するファイルを選択')).toHaveAttribute('accept', '.pdf,.jpg,.jpeg,.png,.mp4');
    await drawer.getByLabel('添付するファイルを選択').setInputFiles([pdf, { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('mock') }]);
    await expect(drawer.getByText('notice.pdf')).toBeVisible();
    await expect(drawer.getByText('clip.mp4')).toBeVisible();
    await expect(drawer.getByText('確認中', { exact: true })).toHaveCount(2);
    await expect(drawer.getByRole('button', { name: 'notice.pdfを開く（新しいタブ）' })).toBeVisible({ timeout: 9000 });
    // 確認用データは原本を持たないので、同じ種類の見本のファイル（同じオリジン）を開く。開いた先を記録して確かめる。
    await page.evaluate(() => { window.open = (url) => { document.body.dataset.openedUrl = String(url); return null; }; });
    await drawer.getByRole('button', { name: 'notice.pdfを開く（新しいタブ）' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-opened-url', /^\/assets\/sample-notice-[\w-]+\.pdf$/);
    const sample = await page.request.get(await page.locator('body').getAttribute('data-opened-url') ?? '');
    expect(sample.status()).toBe(200);
    expect((await sample.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('deleting an attachment asks first', async ({ page }) => {
    await page.goto('/notes/memo-school');
    const drawer = page.getByRole('dialog', { name: '学校公開のお知らせ' });
    await drawer.getByRole('button', { name: '学校公開.pdfを削除' }).click();
    const confirm = page.getByRole('dialog', { name: '添付ファイルを削除しますか' });
    await expect(confirm.getByText('元に戻せません')).toBeVisible();
    await confirm.getByRole('button', { name: 'キャンセル' }).click();
    await expect(drawer.getByText('学校公開.pdf')).toBeVisible();
    await drawer.getByRole('button', { name: '学校公開.pdfを削除' }).click();
    await page.getByRole('dialog', { name: '添付ファイルを削除しますか' }).getByRole('button', { name: '削除する' }).click();
    await expect(toast(page)).toContainText('「学校公開.pdf」を削除しました');
    await expect(drawer.getByText('学校公開.pdf')).toHaveCount(0);
  });

  test('a file that can never be accepted says why and can be removed, with no retry', async ({ page }) => {
    await page.goto('/notes/memo-clinic');
    const drawer = page.getByRole('dialog', { name: '小児科の控え' });
    await drawer.getByLabel('添付するファイルを選択').setInputFiles([
      { name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('mock') },
      { name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10_000_001) },
    ]);
    await expect(drawer.getByText(/添付できるのはPDF・JPEG・PNG・MP4です。/)).toBeVisible();
    await expect(drawer.getByText(/PDFと画像は10MB以内にしてください。/)).toBeVisible();
    await expect(drawer.getByRole('button', { name: /もう一度送る/ })).toHaveCount(0);
    await drawer.getByRole('button', { name: 'photo.heicを取り除く' }).click();
    await expect(drawer.getByText('photo.heic')).toHaveCount(0);
  });

  test('an upload that fails stays queued and can be retried; files are never put in the offline queue', async ({ page }) => {
    await page.goto('/notes/memo-school?scenario=offline');
    const drawer = page.getByRole('dialog', { name: '学校公開のお知らせ' });
    await drawer.getByLabel('添付するファイルを選択').setInputFiles(pdf);
    await expect(drawer.getByText(/notice\.pdf/)).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'notice.pdfをもう一度送る' })).toBeVisible();
    await drawer.getByRole('button', { name: 'notice.pdfをもう一度送る' }).click();
    await expect(drawer.getByRole('button', { name: 'notice.pdfをもう一度送る' })).toBeVisible();
    await expect(drawer.locator('.attachment-row')).toHaveCount(2);

    await drawer.getByRole('button', { name: '閉じる' }).click();
    await page.getByRole('button', { name: 'メモを追加' }).click();
    const form = page.getByRole('dialog', { name: 'メモを作る' });
    await form.getByLabel('タイトル').fill('添付つきのメモ');
    await form.getByLabel('本文').fill('本文');
    await form.getByLabel('一緒に添付するファイルを選択').setInputFiles(pdf);
    await expect(form.getByText('notice.pdf')).toBeVisible();
    await form.getByRole('button', { name: '作成する' }).click();
    await expect(form.getByRole('alert')).toContainText('インターネットに接続できません');
    await expect(form.getByText('notice.pdf')).toBeVisible();
    await expect(form.getByLabel('タイトル')).toHaveValue('添付つきのメモ');
    await expect(page.getByRole('button', { name: /未送信の変更/ })).toHaveCount(0);
  });

  test('a new memo can bring files along', async ({ page }) => {
    await page.goto('/notes');
    await page.getByRole('button', { name: 'メモを追加' }).click();
    const form = page.getByRole('dialog', { name: 'メモを作る' });
    await form.getByLabel('タイトル').fill('添付つきのメモ');
    await form.getByLabel('本文').fill('本文');
    await form.getByLabel('一緒に添付するファイルを選択').setInputFiles([pdf, { name: 'bad.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('mock') }]);
    await expect(form.getByText('添付できるのはPDF・JPEG・PNG・MP4です。')).toBeVisible();
    await form.getByRole('button', { name: 'bad.exeを選択から外す' }).click();
    await form.getByRole('button', { name: '作成する' }).click();
    const drawer = page.getByRole('dialog', { name: '添付つきのメモ' });
    await expect(drawer.getByText('notice.pdf')).toBeVisible();
    await expect(drawer.getByText('確認中', { exact: true })).toBeVisible();
  });

  test('OCR text can be corrected and cleared, and search follows it', async ({ page }) => {
    await page.goto('/notes/memo-school');
    const drawer = page.getByRole('dialog', { name: '学校公開のお知らせ' });
    await drawer.getByRole('button', { name: '文字を修正' }).click();
    await drawer.getByLabel('文字認識の結果を修正').fill('受付は講堂の前です');
    await drawer.getByRole('button', { name: '変更を保存' }).click();
    await expect(toast(page)).toContainText('文字認識の結果を修正しました');
    await expect(drawer.getByText('受付は講堂の前です')).toBeVisible();
    await drawer.getByRole('button', { name: '閉じる' }).click();
    await page.getByLabel('メモを検索').fill('講堂');
    await expect(titles(page)).toHaveText(['学校公開のお知らせ']);

    await page.getByRole('link', { name: /学校公開のお知らせ/ }).click();
    await drawer.getByRole('button', { name: '文字を修正' }).click();
    await drawer.getByLabel('文字認識の結果を修正').fill('   ');
    await drawer.getByRole('button', { name: '変更を保存' }).click();
    await expect(drawer.getByText('読み取った文字はありません。')).toBeVisible();
    await expect(drawer.getByRole('button', { name: '文字を入力' })).toBeVisible();
  });

  test('only the author sees delete; an adult can still edit', async ({ page }) => {
    await page.goto('/notes/memo-clinic');
    await expect(page.getByRole('button', { name: '内容を編集' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'メモを削除' })).toHaveCount(0);
    await page.goto('/notes/memo-clinic?actor=member-ren');
    await expect(page.getByRole('button', { name: 'メモを削除' })).toBeVisible();
  });

  test('memo detail with attachments fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/notes/memo-receipt');
    await expect(page.getByRole('dialog', { name: '教材費レシート' }).getByText('receipt.jpg')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test('the default sharing choice is not described as everyone', async ({ page }) => {
  await page.goto('/settings/privacy');
  await expect(page.getByLabel(/大人のメンバーと関わる人/)).toBeVisible();
  await expect(page.getByText('家族全員')).toHaveCount(0);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /次へ/ }).click();
  await expect(page.getByRole('button', { name: '大人のメンバーと関わる人に共有する' })).toBeVisible();
  await expect(page.getByText('家族全員')).toHaveCount(0);
});
