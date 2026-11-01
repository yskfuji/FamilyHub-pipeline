import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const clip = readFileSync(new URL('./fixtures/clip.webm', import.meta.url));
const photo = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, name.length]) });
const video = (name: string) => ({ name, mimeType: 'video/mp4', buffer: clip });
const toast = (page: Page) => page.locator('.toast-visible');
const tiles = (page: Page) => page.locator('.album-tile-media');
const count = (screen: Locator) => screen.locator('.media-count');
/** 隠れた操作を、マウスを動かして戻す。 */
const wake = async (page: Page) => { await page.mouse.move(100, 100); await page.mouse.move(140, 140); };

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

async function openUpload(page: Page) {
  await page.getByRole('button', { name: '写真や動画を追加' }).first().click();
  return page.getByRole('dialog', { name: '写真や動画を追加' });
}

async function upload(page: Page, files: Parameters<Locator['setInputFiles']>[0]) {
  const dialog = await openUpload(page);
  await dialog.getByLabel('アルバムに追加するファイルを選択').setInputFiles(files);
  await dialog.getByRole('button', { name: /件を送る$/ }).click();
  await expect(dialog.getByRole('status').first()).toContainText(/(\d+) \/ \1件 完了/, { timeout: 15_000 });
  await dialog.getByRole('button', { name: '閉じる' }).first().click();
}

async function makeAlbum(page: Page, title: string) {
  await page.goto('/albums');
  await page.getByRole('button', { name: 'アルバムを作る' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'アルバムを作る' });
  await dialog.getByLabel('アルバム名').fill(title);
  await dialog.getByRole('button', { name: '作成する' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
}

test.describe('album list', () => {
  test('shows albums with cover, title and count, and leads to the detail', async ({ page }) => {
    await page.goto('/albums');
    const card = page.getByRole('link', { name: /運動会/ });
    await expect(card).toContainText('3件');
    await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/svg/);
    await expect(page.getByRole('link', { name: /週末の公園/ }).locator('img')).toHaveAttribute('src', /^data:image\/svg/);
    await card.click();
    await expect(page).toHaveURL(/\/albums\/album-sports$/);
    await expect(page.getByRole('heading', { name: '運動会', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'アルバムの一覧' }).click();
    await expect(page).toHaveURL(/\/albums$/);
  });

  test('the navigation lists albums, and on a phone it sits under その他 without pushing anything out', async ({ page }) => {
    await page.goto('/today');
    await expect(page.getByRole('navigation', { name: '主な機能' }).getByRole('link', { name: 'アルバム' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = page.getByRole('navigation', { name: 'モバイルの主な機能' });
    await expect(mobile.getByRole('link')).toHaveText(['今日', '予定', 'タスク', 'メモ']);
    await mobile.getByRole('button', { name: 'その他', exact: true }).click();
    await page.getByRole('navigation', { name: 'その他の機能' }).getByRole('link', { name: 'アルバム' }).click();
    await expect(page).toHaveURL(/\/albums$/);
    await expect(mobile.getByRole('button', { name: /表示中：アルバム/ })).toBeVisible();
  });

  test('creating validates, offers no participants audience, and opens the new album', async ({ page }) => {
    await page.goto('/albums');
    await page.getByRole('button', { name: 'アルバムを作る' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'アルバムを作る' });
    await dialog.getByRole('button', { name: '作成する' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('アルバム名を入力してください。');
    await expect(dialog.getByLabel('公開範囲').locator('option')).toHaveText(['大人のメンバーと関わる人', '大人のメンバー', '作成した本人', '選択したメンバー']);
    await dialog.getByLabel('アルバム名').fill('夏の旅行');
    await dialog.getByLabel('説明（任意）').fill('海へ行きました');
    await dialog.getByLabel('スライドショーの曲').selectOption({ label: 'やさしい曲' });
    await dialog.getByRole('button', { name: '作成する' }).click();
    await expect(page).toHaveURL(/\/albums\/album-/);
    await expect(page.getByText('まだ写真や動画はありません')).toBeVisible();
    await expect(page.getByText(/海へ行きました/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'スライドショー' })).toBeDisabled();
  });

  test('editing changes the title, and deleting asks first and can be undone from the list', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '編集' }).click();
    const form = page.getByRole('dialog', { name: 'アルバムを編集' });
    await expect(form.getByLabel('スライドショーの曲')).toHaveValue('bright');
    await form.getByLabel('アルバム名').fill('秋の運動会');
    await form.getByRole('button', { name: '保存する' }).click();
    await expect(page.getByRole('heading', { name: '秋の運動会', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'アルバムを削除' }).click();
    const confirm = page.getByRole('dialog', { name: 'アルバムを削除しますか' });
    await expect(confirm).toContainText('7日以内');
    await confirm.getByRole('button', { name: '削除する' }).click();
    await expect(page).toHaveURL(/\/albums$/);
    await expect(page.getByRole('link', { name: /秋の運動会/ })).toHaveCount(0);
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.getByRole('link', { name: /秋の運動会/ })).toBeVisible();
    await expect(toast(page)).toContainText('元に戻しました');
  });
});

test.describe('album detail', () => {
  test('filters live in the URL and count each kind', async ({ page }) => {
    await makeAlbum(page, '絞り込み');
    await upload(page, [photo('a.jpg'), video('b.mp4')]);
    const filter = page.getByRole('group', { name: '表示する種類' });
    await expect(filter.getByRole('button')).toHaveText(['すべて 2', '写真 1', '動画 1']);
    await filter.getByRole('button', { name: /動画/ }).click();
    await expect(page).toHaveURL(/\?filter=videos$/);
    await expect(tiles(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: '動画「b.mp4」を開く' })).toBeVisible();
    await filter.getByRole('button', { name: /すべて/ }).click();
    await expect(page).not.toHaveURL(/filter/);
  });

  test('reorders with the keyboard, keeps focus, and sets a cover', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    const names = page.locator('.album-organize-row .file-name');
    await expect(names).toHaveText(['item-sports-1.jpg', 'item-sports-2.jpg', 'item-sports-3.jpg']);
    await expect(page.getByRole('button', { name: 'item-sports-1.jpgを前へ移動' })).toBeDisabled();

    const later = page.getByRole('button', { name: 'item-sports-1.jpgを後ろへ移動' });
    await later.focus();
    await page.keyboard.press('Enter');
    await expect(names).toHaveText(['item-sports-2.jpg', 'item-sports-1.jpg', 'item-sports-3.jpg']);
    await expect(later).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(names).toHaveText(['item-sports-2.jpg', 'item-sports-3.jpg', 'item-sports-1.jpg']);
    // 端まで来たら反対のボタンへ移す（押したボタンは無効になる）。
    await expect(page.getByRole('button', { name: 'item-sports-1.jpgを前へ移動' })).toBeFocused();

    await page.getByRole('button', { name: 'item-sports-2.jpgを表紙にする' }).click();
    await expect(toast(page)).toContainText('表紙にしました');
    await expect(page.locator('.album-organize-row').first()).toContainText('表紙');

    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await expect(page.getByRole('button', { name: /を開く$/ }).first()).toHaveAccessibleName('写真「item-sports-2.jpg」を開く');
  });

  test('moving while filtered still sends the whole order', async ({ page }) => {
    await makeAlbum(page, '絞り込みの並べ替え');
    await upload(page, [photo('a.jpg'), video('v.mp4'), photo('b.jpg')]);
    await page.getByRole('group', { name: '表示する種類' }).getByRole('button', { name: /写真/ }).click();
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await page.getByRole('button', { name: 'b.jpgを前へ移動' }).click();
    await expect(page.locator('.album-organize-row .file-name')).toHaveText(['b.jpg', 'a.jpg']);
    await expect(toast(page)).toHaveCount(0);
  });

  test('deleting an item can be undone, and the location badge shows only when kept', async ({ page }) => {
    await makeAlbum(page, '撮影場所');
    const dialog = await openUpload(page);
    await expect(dialog.getByRole('switch', { name: '撮影場所を残す' })).not.toBeChecked();
    await expect(dialog.getByText(/オンにすると撮影場所の情報がファイルに残り/)).toBeVisible();
    await dialog.getByRole('switch', { name: '撮影場所を残す' }).check();
    await dialog.getByLabel('アルバムに追加するファイルを選択').setInputFiles([photo('kept.jpg')]);
    await dialog.getByRole('button', { name: '1件を送る' }).click();
    await expect(dialog.getByText('1 / 1件 完了')).toBeVisible();
    await dialog.getByRole('switch', { name: '撮影場所を残す' }).uncheck();
    await dialog.getByLabel('アルバムに追加するファイルを選択').setInputFiles([photo('plain.jpg')]);
    await dialog.getByRole('button', { name: '1件を送る' }).click();
    await expect(dialog.getByText('2 / 2件 完了')).toBeVisible();
    await dialog.getByRole('button', { name: '閉じる' }).first().click();
    await expect(page.getByText('撮影場所を残しています')).toHaveCount(1);

    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await page.getByRole('button', { name: 'plain.jpgを削除' }).click();
    await expect(page.getByText('「plain.jpg」を削除しました')).toBeVisible();
    await expect(page.locator('.album-organize-row')).toHaveCount(1);
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.album-organize-row')).toHaveCount(2);
  });

  test('a child who cannot see an album gets not-found, and delete is hidden from people not involved', async ({ page }) => {
    await page.goto('/albums?actor=member-hana');
    await expect(page.getByRole('link', { name: /運動会/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /週末の公園/ })).toHaveCount(0);
    await page.goto('/albums/album-park?actor=member-hana');
    await expect(page.getByText('アルバムが見つからないか、表示する権限がありません')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('週末の公園');

    await page.goto('/albums/album-sports?actor=member-ren');
    await expect(page.getByRole('heading', { name: '運動会', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'アルバムを削除' })).toHaveCount(0);
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await expect(page.getByRole('button', { name: 'item-sports-1.jpgを削除' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'item-sports-3.jpgを削除' })).toBeVisible();
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await page.getByRole('button', { name: '写真「item-sports-1.jpg」を開く' }).click();
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    await expect(viewer.getByRole('button', { name: /を削除$/ })).toHaveCount(0);
  });

  test('a guest can look and save but not change anything', async ({ page }) => {
    await page.goto('/albums?actor=member-yui');
    await expect(page.getByRole('heading', { name: '家族のアルバム' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'アルバムを作る' })).toHaveCount(0);
  });
});

test.describe('upload queue', () => {
  test('files wait in a queue that can be reordered and trimmed before sending', async ({ page }) => {
    await makeAlbum(page, '待ち行列');
    const dialog = await openUpload(page);
    await expect(dialog.getByLabel('アルバムに追加するファイルを選択')).toHaveAttribute('accept', 'image/jpeg,image/png,video/mp4,video/quicktime');
    await dialog.getByLabel('アルバムに追加するファイルを選択').setInputFiles([photo('1.jpg'), photo('2.jpg'), photo('3.jpg')]);
    const names = dialog.locator('.album-upload-row .file-name');
    await expect(names).toHaveText(['1.jpg', '2.jpg', '3.jpg']);
    await dialog.getByRole('button', { name: '3.jpgを前へ' }).click();
    await expect(names).toHaveText(['1.jpg', '3.jpg', '2.jpg']);
    await dialog.getByRole('button', { name: '1.jpgを一覧から外す' }).click();
    await expect(names).toHaveText(['3.jpg', '2.jpg']);
    await dialog.getByRole('button', { name: '2件を送る' }).click();
    await expect(dialog.getByText('2 / 2件 完了')).toBeVisible();
    await dialog.getByRole('button', { name: '完了した分を一覧から消す' }).click();
    await expect(names).toHaveCount(0);
    await dialog.getByRole('button', { name: '閉じる' }).first().click();
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await expect(page.locator('.album-organize-row .file-name')).toHaveText(['3.jpg', '2.jpg']);
  });

  test('files arrive in the order they were lined up, even when a video needs a thumbnail first', async ({ page }) => {
    await makeAlbum(page, '順番');
    await upload(page, [video('first.mp4'), photo('second.jpg'), photo('third.jpg')]);
    await page.getByRole('button', { name: '並べ替え・整理' }).click();
    await expect(page.locator('.album-organize-row .file-name')).toHaveText(['first.mp4', 'second.jpg', 'third.jpg']);
  });

  test('HEIC and other refused files stay listed with the reason and are not sent', async ({ page }) => {
    await makeAlbum(page, '拒否');
    const dialog = await openUpload(page);
    await dialog.getByLabel('アルバムに追加するファイルを選択').setInputFiles([{ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('x') }, { name: 'note.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') }]);
    await expect(dialog.getByText('HEIC の写真は受け付けていません。JPEG で保存し直してください。')).toBeVisible();
    await expect(dialog.getByText('JPEG・PNG・MP4・MOV のファイルを選んでください。')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /件を送る$/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'photo.heicをもう一度送る' })).toHaveCount(0);
  });

  test('a video gets a thumbnail made on the device', async ({ page }) => {
    await makeAlbum(page, '動画の縮小画像');
    await upload(page, [video('clip.mp4')]);
    await expect(page.getByRole('button', { name: '動画「clip.mp4」を開く' }).locator('img')).toHaveAttribute('src', /^blob:/);
  });

  test('a video that cannot be read still uploads, with a placeholder', async ({ page }) => {
    await makeAlbum(page, '読めない動画');
    await upload(page, [{ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video') }]);
    const tile = page.getByRole('button', { name: '動画「broken.mp4」を開く' });
    await expect(tile.locator('img')).toHaveCount(0);
    await expect(tile.locator('.album-placeholder')).toBeVisible();
  });
});

test.describe('viewer', () => {
  test('arrows move, Escape closes, focus returns to the item shown last, and the info sheet tells the location state', async ({ page }) => {
    await page.goto('/albums/album-sports');
    const first = page.getByRole('button', { name: '写真「item-sports-1.jpg」を開く' });
    await first.click();
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    await expect(count(viewer)).toContainText('1 / 3');
    await expect(viewer.locator('img')).toHaveAttribute('alt', 'item-sports-1.jpg');
    await page.keyboard.press('ArrowRight');
    await expect(count(viewer)).toContainText('2 / 3');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(count(viewer)).toContainText('3 / 3');

    await viewer.getByRole('button', { name: '詳しい情報' }).click();
    const info = viewer.getByRole('complementary', { name: '詳しい情報' });
    await expect(info).toContainText('item-sports-3.jpg');
    await expect(info).toContainText('2.4 MB');
    await expect(info).toContainText('2026年9月20日');
    await expect(info).toContainText('撮影場所は取り除いて保存しています');
    await page.keyboard.press('Escape');
    await expect(info).toHaveCount(0);
    await expect(viewer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await expect(page.getByRole('button', { name: '写真「item-sports-3.jpg」を開く' })).toBeFocused();
  });

  test('controls hide after 3.5 seconds without input and return on any input', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '写真「item-sports-1.jpg」を開く' }).click();
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    await expect(viewer).toHaveAttribute('data-controls', 'shown');
    await expect(viewer).toHaveAttribute('data-controls', 'hidden', { timeout: 5000 });
    await expect(viewer.getByRole('button', { name: '次の項目' })).toHaveCSS('opacity', '0');
    await page.mouse.move(200, 200);
    await expect(viewer).toHaveAttribute('data-controls', 'shown');
    await expect(viewer).toHaveAttribute('data-controls', 'hidden', { timeout: 5000 });
    await page.keyboard.press('Tab');
    await expect(viewer).toHaveAttribute('data-controls', 'shown');
  });

  test('a swipe moves between items and a vertical drag does not', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '写真「item-sports-1.jpg」を開く' }).click();
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    const swipe = (fromX: number, toX: number, fromY: number, toY: number) => viewer.locator('.media-stage').evaluate((stage, points) => {
      const touch = (x: number, y: number) => new Touch({ identifier: 1, target: stage, clientX: x, clientY: y });
      stage.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, changedTouches: [touch(points[0], points[2])] }));
      stage.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [touch(points[1], points[3])] }));
    }, [fromX, toX, fromY, toY]);
    await swipe(300, 100, 200, 210);
    await expect(count(viewer)).toContainText('2 / 3');
    await swipe(100, 300, 200, 200);
    await expect(count(viewer)).toContainText('1 / 3');
    await swipe(200, 210, 100, 400);
    await expect(count(viewer)).toContainText('1 / 3');
  });

  test('saves the real file through the browser', async ({ page }) => {
    await makeAlbum(page, '保存');
    await upload(page, [photo('save-me.jpg')]);
    await page.getByRole('button', { name: '写真「save-me.jpg」を開く' }).click();
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    const saved = page.waitForEvent('download');
    await viewer.getByRole('link', { name: 'save-me.jpgを端末に保存' }).click();
    expect((await saved).suggestedFilename()).toBe('save-me.jpg');
  });

  test('deleting moves to the next item and can be undone inside the viewer', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '写真「item-sports-1.jpg」を開く' }).click();
    const viewer = page.getByRole('dialog', { name: '写真を表示' });
    await viewer.getByRole('button', { name: 'item-sports-1.jpgを削除' }).click();
    await expect(viewer.getByRole('status')).toContainText('「item-sports-1.jpg」を削除しました');
    await expect(viewer.locator('img')).toHaveAttribute('alt', 'item-sports-2.jpg');
    await expect(count(viewer)).toContainText('1 / 2');
    await viewer.getByRole('button', { name: '元に戻す' }).click();
    await expect(count(viewer)).toContainText('2 / 3');
    await expect(viewer.getByRole('status')).toHaveCount(0);
  });

  test('closes when the last item is deleted, and the page offers the undo', async ({ page }) => {
    await makeAlbum(page, '最後の1枚');
    await upload(page, [photo('only.jpg')]);
    await page.getByRole('button', { name: '写真「only.jpg」を開く' }).click();
    await page.getByRole('dialog', { name: '写真を表示' }).getByRole('button', { name: 'only.jpgを削除' }).click();
    await expect(page.getByRole('dialog', { name: '写真を表示' })).toHaveCount(0);
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.getByRole('button', { name: '写真「only.jpg」を開く' })).toBeVisible();
  });

  test('a video gets native controls and, where supported, picture-in-picture', async ({ page }) => {
    await makeAlbum(page, '動画');
    await upload(page, [video('clip.mp4')]);
    await page.getByRole('button', { name: '動画「clip.mp4」を開く' }).click();
    const viewer = page.getByRole('dialog', { name: '動画を表示' });
    await expect(viewer.locator('video')).toHaveAttribute('controls', '');
    await expect(viewer.getByRole('button', { name: '小さな窓で再生' })).toBeVisible();
    await expect(viewer).toHaveAttribute('data-controls', 'shown');
  });

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await page.getByRole('button', { name: '写真「item-sports-1.jpg」を開く' }).click();
    await page.getByRole('dialog', { name: '写真を表示' }).getByRole('button', { name: '詳しい情報' }).click();
    expect((await new AxeBuilder({ page }).include('.media-screen').analyze()).violations).toEqual([]);
  });
});

test.describe('slideshow', () => {
  const open = async (page: Page) => {
    await page.getByRole('button', { name: 'スライドショー' }).click();
    return page.getByRole('dialog', { name: /スライドショー/ });
  };

  test('advances by itself, pauses, and closes with Escape back to the button', async ({ page }) => {
    await page.goto('/albums/album-sports');
    const show = await open(page);
    await expect(count(show)).toHaveText('1 / 3');
    await expect(show.locator('img')).toHaveClass(/slide-zoom/);
    await expect(show.getByRole('button', { name: '一時停止' })).toBeFocused();
    await expect(count(show)).toHaveText('2 / 3', { timeout: 7000 });
    await wake(page);
    await show.getByRole('button', { name: '一時停止' }).click();
    await expect(show).toHaveAttribute('data-paused', 'true');
    await page.waitForTimeout(5600);
    await expect(count(show)).toHaveText('2 / 3');
    await expect(show).toHaveAttribute('data-controls', 'shown');
    await show.getByRole('button', { name: '再生' }).click();
    await expect(count(show)).toHaveText('3 / 3', { timeout: 7000 });
    await page.keyboard.press('Escape');
    await expect(show).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'スライドショー' })).toBeFocused();
  });

  test('has no soft zoom under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/albums/album-sports');
    const show = await open(page);
    await expect(show.locator('img')).not.toHaveClass(/slide-zoom/);
  });

  test('honors the setting in the app as well', async ({ page }) => {
    await page.goto('/today');
    await page.evaluate(() => localStorage.setItem('family-hub-reduced-motion', 'true'));
    await page.goto('/albums/album-sports');
    const show = await open(page);
    await expect(show.locator('img')).not.toHaveClass(/slide-zoom/);
  });

  test('stops when the tab is hidden, music included', async ({ page }) => {
    await page.goto('/albums/album-sports');
    const show = await open(page);
    await show.getByRole('button', { name: '曲を流す' }).click();
    await expect(show.getByRole('button', { name: '曲を止める' })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(show).toHaveAttribute('data-paused', 'true');
    await expect(show.getByRole('button', { name: '曲を流す' })).toBeVisible();
    await expect(show.getByRole('status')).toContainText('タブを離れたので止めました');
    await page.waitForTimeout(5600);
    await expect(count(show)).toHaveText('1 / 3');
  });

  test('a video plays to its end before advancing, and can be left out', async ({ page }) => {
    await makeAlbum(page, '動画の入ったスライドショー');
    await upload(page, [video('clip.mp4'), photo('a.jpg')]);
    const show = await open(page);
    await expect(show.locator('video')).toBeVisible();
    const playback = await show.locator('video').evaluate((element: HTMLVideoElement) => new Promise<{ ended: boolean; atEnd: boolean }>((resolve) => {
      element.addEventListener('ended', () => resolve({ ended: true, atEnd: element.currentTime > 1 }), { once: true });
    }));
    expect(playback).toEqual({ ended: true, atEnd: true });
    await expect(show.locator('img')).toBeVisible();
    await expect(count(show)).toHaveText('2 / 2');

    await wake(page);
    await show.getByLabel('動画も流す').uncheck();
    await expect(count(show)).toHaveText('1 / 1');
    await expect(show.locator('video')).toHaveCount(0);
  });

  test('an album of videos keeps them when videos are left out, and says so', async ({ page }) => {
    await makeAlbum(page, '動画だけ');
    await upload(page, [video('clip.mp4')]);
    const show = await open(page);
    await show.getByLabel('動画も流す').uncheck();
    await expect(show.getByRole('status')).toContainText('写真がないので');
    await expect(show.locator('video')).toBeVisible();
  });

  test('each music preset starts only when asked, with no console errors or network requests, and stops on close', async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      const contexts: AudioContext[] = [];
      (window as unknown as { audioContexts: AudioContext[] }).audioContexts = contexts;
      const Original = window.AudioContext;
      window.AudioContext = class extends Original { constructor(...args: ConstructorParameters<typeof Original>) { super(...args); contexts.push(this); } };
    });
    await page.goto('/albums/album-sports');
    const states = () => page.evaluate(() => (window as unknown as { audioContexts: AudioContext[] }).audioContexts.map((context) => context.state));
    const show = await open(page);
    await expect(show.getByLabel('曲', { exact: true })).toHaveValue('bright');
    expect(await states()).toEqual([]);

    const requests: string[] = [];
    page.on('request', (request) => { if (!request.url().startsWith('data:') && !request.url().startsWith('blob:')) requests.push(request.url()); });
    await show.getByRole('button', { name: '曲を流す' }).click();
    await expect(show.getByRole('button', { name: '曲を止める' })).toBeVisible();
    await expect.poll(states).toEqual(['running']);
    for (const label of ['落ち着いた曲', 'やさしい曲']) {
      await show.getByLabel('曲', { exact: true }).selectOption({ label });
      await expect.poll(async () => (await states()).filter((state) => state === 'running').length).toBe(1);
    }
    await show.getByLabel('音量').fill('0.2');
    expect(requests).toEqual([]);
    await show.getByRole('button', { name: '閉じる' }).click();
    await expect.poll(async () => (await states()).every((state) => state === 'closed')).toBe(true);
    expect(errors).toEqual([]);
  });

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/albums/album-sports');
    await open(page);
    expect((await new AxeBuilder({ page }).include('.media-screen').analyze()).violations).toEqual([]);
  });
});

test('save all downloads every file one at a time with a count', async ({ page }) => {
  await makeAlbum(page, 'すべて保存');
  await upload(page, [photo('one.jpg'), photo('two.jpg')]);
  const names: string[] = [];
  page.on('download', (download) => names.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'すべて端末に保存' }).click();
  await expect(page.getByRole('button', { name: /1 \/ 2件 保存中/ })).toBeVisible();
  await expect(toast(page)).toContainText('2件の保存を始めました');
  expect(names.sort()).toEqual(['one.jpg', 'two.jpg']);
});

for (const width of [320, 390, 768, 1440]) {
  test(`album screens have no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/albums', '/albums/album-sports']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, route).toBe(0);
    }
  });
}
