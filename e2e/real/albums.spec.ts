import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { readPhotoGps } from '../../src/features/place/exif';
import { failOnCspViolation, signIn } from './support';

const GPS = { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 40/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '139/1 45/1 0/1' } };
const jpeg = async (red: number) => sharp({ create: { width: 320, height: 240, channels: 3, background: { r: red, g: 120, b: 80 } } }).withExif(GPS).jpeg().toBuffer();
const asFile = (name: string, buffer: Buffer, mimeType = 'image/jpeg') => ({ name, mimeType, buffer });
const hasGps = async (bytes: Buffer) => (await readPhotoGps(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }))).status === 'found';

/** 位置情報を持たない、形だけの MP4。 */
function sampleVideo() {
  const box = (type: string, body: Buffer) => { const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1'); return Buffer.concat([header, body]); };
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom', 'latin1')), box('moov', box('udta', Buffer.alloc(8))), box('mdat', Buffer.alloc(64, 7))]);
}

// サインインの回数には上限があるので、このファイルでは1回だけサインインし、同じ画面で順に確かめる。
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let violations: string[];
let consoleErrors: string[];
let albumPath = '';
const contextOptions = (info: TestInfo) => ({ baseURL: info.project.use.baseURL, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });

test.beforeAll(async ({ browser }, info) => {
  context = await browser.newContext(contextOptions(info));
  page = await context.newPage();
  violations = failOnCspViolation(page);
  consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await signIn(page, 'ren@example.test');
});
test.afterAll(async () => { await context.close(); });

const uploadDialog = () => page.getByRole('dialog', { name: '写真や動画を追加' });
async function choose(files: Parameters<Locator['setInputFiles']>[0], keepLocation = false) {
  if (!(await uploadDialog().isVisible())) await page.getByRole('button', { name: /写真や動画を追加|状況を見る/ }).first().click();
  const dialog = uploadDialog();
  await dialog.getByLabel('アルバムに追加するファイルを選択').setInputFiles(files);
  if (keepLocation) await dialog.getByRole('switch', { name: '撮影場所を残す' }).check();
  return dialog;
}
const send = (dialog: Locator) => dialog.getByRole('button', { name: /件を送る$/ }).click();
const closeDialog = (dialog: Locator) => dialog.getByRole('button', { name: '閉じる' }).first().click();
const filesInGrid = () => page.locator('.album-tile-media');
const opening = (name: string) => page.getByRole('button', { name: `写真「${name}」を開く` });
const fileUrl = (item: Locator) => item.locator('img').getAttribute('src');

test('creates an album, and a real JPEG reaches ready with a thumbnail and no GPS in the stored file', async () => {
  await page.goto('/albums');
  await page.getByRole('button', { name: 'アルバムを作る' }).first().click();
  const form = page.getByRole('dialog', { name: 'アルバムを作る' });
  await form.getByLabel('アルバム名').fill('実スタックの旅行');
  await form.getByLabel('公開範囲').selectOption('adults');
  await form.getByLabel('スライドショーの曲').selectOption('gentle');
  await form.getByRole('button', { name: '作成する' }).click();
  await expect(page.getByRole('heading', { name: '実スタックの旅行', level: 1 })).toBeVisible();
  albumPath = new URL(page.url()).pathname;

  const bytes = await jpeg(200);
  expect(await hasGps(bytes)).toBe(true);
  const dialog = await choose([asFile('海.jpg', bytes)]);
  await expect(dialog.getByRole('switch', { name: '撮影場所を残す' })).not.toBeChecked();
  await send(dialog);
  await expect(dialog.getByText('1 / 1件 完了')).toBeVisible({ timeout: 15_000 });
  await closeDialog(dialog);

  const thumbnail = opening('海.jpg').locator('img');
  await expect(thumbnail).toHaveAttribute('src', /^\/v1\/albums\/.+\/thumbnail$/);
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText('撮影場所を残しています')).toHaveCount(0);

  const url = (await fileUrl(opening('海.jpg')))!.replace('/thumbnail', '/file');
  const stored = await context.request.get(url);
  expect(stored.status()).toBe(200);
  expect(stored.headers()['content-type']).toBe('image/jpeg');
  expect(await hasGps(await stored.body())).toBe(false);
});

test('keeping the location is a choice, and it shows', async () => {
  const dialog = await choose([asFile('山.jpg', await jpeg(90))], true);
  await send(dialog);
  await expect(dialog.getByText('2 / 2件 完了')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: '完了した分を一覧から消す' }).click();
  await closeDialog(dialog);
  await expect(page.getByText('撮影場所を残しています')).toHaveCount(1);
  const url = (await fileUrl(opening('山.jpg')))!.replace('/thumbnail', '/file');
  expect(await hasGps(await (await context.request.get(url)).body())).toBe(true);
});

test('the same file again is reported as a duplicate, not as a failure', async () => {
  const dialog = await choose([asFile('海のコピー.jpg', await jpeg(200))]);
  await send(dialog);
  await expect(dialog.getByText('同じ写真がすでにあります。')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('1 / 1件 完了')).toBeVisible();
  await expect(dialog.getByText(/追加できませんでした/)).toHaveCount(0);
  await dialog.getByRole('button', { name: '完了した分を一覧から消す' }).click();
  await closeDialog(dialog);
  await expect(filesInGrid()).toHaveCount(2);
  await expect(page.getByRole('heading', { name: '保存できなかったファイル' })).toHaveCount(0);
});

test('a disguised file and a HEIC named .jpg are refused with the message, and offer no retry', async () => {
  const heic = Buffer.concat([Buffer.from('\0\0\0\x18ftypheic', 'latin1'), Buffer.alloc(32)]);
  const dialog = await choose([asFile('fake.jpg', Buffer.from('<script>alert(1)</script>')), asFile('iphone.jpg', heic)]);
  await send(dialog);
  await expect(dialog.getByText('この形式のファイルは受け付けていません。')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('HEIC の写真は受け付けていません。JPEG で保存し直してください。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'fake.jpgをもう一度送る' })).toHaveCount(0);
  await expect(dialog.getByText('2件 追加できませんでした')).toBeVisible();
  await dialog.getByRole('button', { name: 'fake.jpgを一覧から外す' }).click();
  await dialog.getByRole('button', { name: 'iphone.jpgを一覧から外す' }).click();
  await closeDialog(dialog);
  await expect(page.getByRole('heading', { name: '保存できなかったファイル' })).toBeVisible();
  await page.getByRole('button', { name: 'fake.jpgを一覧から外す' }).click();
  await expect(page.getByRole('button', { name: 'iphone.jpgを一覧から外す' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'fake.jpgを一覧から外す' })).toHaveCount(0);
  await page.getByRole('button', { name: 'iphone.jpgを一覧から外す' }).click();
  await expect(page.getByRole('heading', { name: '保存できなかったファイル' })).toHaveCount(0);
});

test('a failed attempt stays listed, and retrying continues the same upload', async () => {
  let created = 0;
  let failed = false;
  const creating = (route: import('@playwright/test').Route) => { if (route.request().method() === 'POST') created += 1; return route.continue(); };
  const patching = (route: import('@playwright/test').Route) => {
    if (failed || route.request().method() !== 'PATCH') return route.continue();
    failed = true;
    return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ code: 'UPSTREAM_FAILURE', message: '応答を受け取れませんでした。少し待ってからお試しください。', retryable: true }) });
  };
  await page.route('**/v1/uploads', creating);
  await page.route('**/v1/uploads/*', patching);
  const dialog = await choose([asFile('再送.jpg', await jpeg(30))]);
  await send(dialog);
  const retry = dialog.getByRole('button', { name: '再送.jpgをもう一度送る' });
  await expect(retry).toBeVisible();
  await expect(dialog.getByText('応答を受け取れませんでした。少し待ってからお試しください。')).toBeVisible();
  await retry.click();
  await expect(dialog.getByText('追加しました')).toBeVisible({ timeout: 15_000 });
  expect(created).toBe(1);
  await page.unroute('**/v1/uploads', creating);
  await page.unroute('**/v1/uploads/*', patching);
  await dialog.getByRole('button', { name: '完了した分を一覧から消す' }).click();
  await closeDialog(dialog);
  await expect(opening('再送.jpg')).toBeVisible();
});

test('cancelling releases the slots, so more files than the limit still all arrive', async () => {
  const held: Array<() => void> = [];
  const hold = (route: import('@playwright/test').Route) => { if (route.request().method() !== 'PATCH') return route.continue(); held.push(() => void route.abort().catch(() => undefined)); return undefined; };
  await page.route('**/v1/uploads/*', hold);
  const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/v1/uploads/'));
  const dialog = await choose([asFile('中止1.jpg', await jpeg(10)), asFile('中止2.jpg', await jpeg(11)), asFile('中止3.jpg', await jpeg(12)), asFile('中止4.jpg', await jpeg(13)), asFile('中止5.jpg', await jpeg(14))]);
  await send(dialog);
  await expect.poll(() => held.length).toBe(3);
  await expect(dialog.getByText('送っています…')).toHaveCount(3);
  await expect(dialog.getByText('順番を待っています')).toHaveCount(2);
  await dialog.getByRole('button', { name: '送信を中止' }).click();
  await expect(dialog.getByRole('button', { name: '5件を送る' })).toBeVisible();
  expect((await deleted).status()).toBe(204);
  await page.unroute('**/v1/uploads/*', hold);
  held.forEach((abort) => abort());

  await send(dialog);
  await expect(dialog.getByText('5 / 5件 完了')).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: '完了した分を一覧から消す' }).click();
  await closeDialog(dialog);
  await expect(filesInGrid()).toHaveCount(8);
});

test('a video the device cannot make a thumbnail for still uploads', async () => {
  const dialog = await choose([asFile('動画.mp4', sampleVideo(), 'video/mp4')]);
  await send(dialog);
  await expect(dialog.getByText('追加しました')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: '完了した分を一覧から消す' }).click();
  await closeDialog(dialog);
  const tile = page.getByRole('button', { name: '動画「動画.mp4」を開く' });
  await expect(tile.locator('.album-placeholder')).toBeVisible();
  // このブラウザは H.264 を読めないので再生までは確かめず、CSP と権限の下で配信されることを見る。
  const served = page.waitForResponse((response) => response.url().endsWith('/file'));
  await tile.click();
  expect([200, 206]).toContain((await served).status());
  await page.keyboard.press('Escape');
  await page.getByRole('group', { name: '表示する種類' }).getByRole('button', { name: /写真/ }).click();
  await expect(filesInGrid()).toHaveCount(8);
  await page.getByRole('group', { name: '表示する種類' }).getByRole('button', { name: /すべて/ }).click();
});

test('the order survives a reload, and so does the cover', async () => {
  await page.getByRole('button', { name: '並べ替え・整理' }).click();
  await expect(page.locator('.album-organize-row .file-name')).toHaveText(['海.jpg', '山.jpg', '再送.jpg', '中止1.jpg', '中止2.jpg', '中止3.jpg', '中止4.jpg', '中止5.jpg', '動画.mp4']);
  await page.getByRole('button', { name: '山.jpgを前へ移動' }).click();
  await expect(page.locator('.album-organize-row .file-name').first()).toHaveText('山.jpg');
  await page.getByRole('button', { name: '再送.jpgを表紙にする' }).click();
  await expect(page.locator('.toast-visible')).toContainText('表紙にしました');
  await page.reload();
  await expect(page.getByRole('button', { name: '写真「山.jpg」を開く' })).toBeVisible();
  await expect(page.getByRole('button', { name: /を開く$/ }).first()).toHaveAccessibleName('写真「山.jpg」を開く');
  await expect(page.locator('.album-tile-cover')).toHaveCount(1);
  await page.goto('/albums');
  const card = page.getByRole('link', { name: /実スタックの旅行/ });
  await expect(card).toContainText('9件');
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${albumPath}$`));
});

test('the viewer moves with the keyboard, returns focus, and saves the actual file', async () => {
  await opening('山.jpg').click();
  const viewer = page.getByRole('dialog', { name: '写真を表示' });
  await expect.poll(() => viewer.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowRight');
  await expect(viewer.locator('img')).toHaveAttribute('alt', '海.jpg');
  await expect(viewer.locator('.media-count')).toContainText('2 / 9');
  await viewer.getByRole('button', { name: '詳しい情報' }).click();
  await expect(viewer.getByRole('complementary', { name: '詳しい情報' })).toContainText('撮影場所は取り除いて保存しています');
  await expect(viewer.getByRole('complementary', { name: '詳しい情報' })).toContainText('追加した人');
  const saved = page.waitForEvent('download');
  await viewer.getByRole('link', { name: '海.jpgを端末に保存' }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe('海.jpg');
  const path = await download.path();
  expect((await sharp(path).metadata()).format).toBe('jpeg');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(opening('海.jpg')).toBeFocused();
});

test('the slideshow advances and pauses, and music starts with no errors under the CSP', async () => {
  await page.getByRole('button', { name: 'スライドショー' }).click();
  const show = page.getByRole('dialog', { name: /スライドショー/ });
  await expect(show.locator('.media-count')).toHaveText('1 / 9');
  await expect(show.getByLabel('曲', { exact: true })).toHaveValue('gentle');
  await show.getByRole('button', { name: '曲を流す' }).click();
  await expect(show.getByRole('button', { name: '曲を止める' })).toBeVisible();
  await expect(show.locator('.media-count')).toHaveText('2 / 9', { timeout: 7000 });
  await page.mouse.move(100, 100);
  await page.mouse.move(140, 140);
  await show.getByRole('button', { name: '一時停止' }).click();
  await page.waitForTimeout(5600);
  await expect(show.locator('.media-count')).toHaveText('2 / 9');
  await show.getByRole('button', { name: '閉じる' }).click();
  await expect(show).toHaveCount(0);
});

test('a child who cannot see the album gets not-found, for the page and for the file', async ({ browser }, info) => {
  const url = (await fileUrl(opening('海.jpg')))!;
  const childContext = await browser.newContext(contextOptions(info));
  const child = await childContext.newPage();
  await signIn(child, 'hana@example.test');
  await child.goto('/albums');
  await expect(child.getByRole('heading', { name: '家族のアルバム' })).toBeVisible();
  await expect(child.getByRole('link', { name: /実スタックの旅行/ })).toHaveCount(0);
  await child.goto(albumPath);
  await expect(child.getByText('アルバムが見つからないか、表示する権限がありません')).toBeVisible();
  expect((await childContext.request.get(url)).status()).toBe(404);
  await childContext.close();
});

test('deleting an item and the album can both be undone', async () => {
  await page.getByRole('button', { name: '並べ替え・整理' }).click();
  await page.getByRole('button', { name: '海.jpgを削除' }).click();
  await expect(page.getByText('「海.jpg」を削除しました')).toBeVisible();
  await expect(page.locator('.album-organize-row')).toHaveCount(8);
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.locator('.album-organize-row')).toHaveCount(9);

  await page.getByRole('button', { name: 'アルバムを削除' }).click();
  await page.getByRole('dialog', { name: 'アルバムを削除しますか' }).getByRole('button', { name: '削除する' }).click();
  await expect(page).toHaveURL(/\/albums$/);
  await expect(page.getByRole('link', { name: /実スタックの旅行/ })).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByRole('link', { name: /実スタックの旅行/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: /実スタックの旅行/ })).toBeVisible();
});

test('nothing above broke the CSP or threw', () => {
  expect(violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
