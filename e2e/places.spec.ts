import { expect, test, type Page, type Request } from '@playwright/test';
import { buildJpegWithGps, buildJpegWithoutGps } from '../src/features/place/exif.fixtures';

/** 架空の施設データ。並びは距離順ではなく、重複・座標なし・カテゴリ不明を含む（実データの性質を再現）。 */
const facility = (name: string, lat: number | string, lng: number | string, category = 'restaurant', address = '架空県みどり市こもれび町1-2') => ({
  name, name_kana: '', prefecture: '架空県', city: 'みどり市', address, category, business_type: category, lat, lng, level: null,
  source: 'overture', licenses: ['CDLA-Permissive-2.0'], attributions: ['Overture Maps Foundation, overturemaps.org'],
});
const nearbyBody = { count: 5, results: [
  facility('ひだまり食堂', 35.6446, 139.6698),
  facility('座標のない商店', '', ''),
  facility('みどり文具店', 35.64378, 139.66918, 'retail_other', '架空県みどり市こもれび町1-1'),
  facility('ひだまり食堂', 35.6446, 139.6698),
  facility('こもれびベーカリー', 35.6441, 139.6693, 'unknown'),
] };
const POSITION = { latitude: 35.64375, longitude: 139.66915, accuracy: 20 };

// Service Worker の制御下では通信の差し替えが効かないブラウザがあるため、外部へ出ないよう無効にする。
test.use({ serviceWorkers: 'block' });

type Behavior = { coords?: { latitude: number; longitude: number; accuracy: number }; errorCode?: number };

async function stubGeolocation(page: Page, behavior: Behavior) {
  await page.addInitScript((b: Behavior) => {
    const geolocation = {
      getCurrentPosition(success: PositionCallback, failure?: PositionErrorCallback | null) {
        setTimeout(() => {
          if (b.errorCode) failure?.({ code: b.errorCode, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
          else success({ coords: { ...b.coords, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as unknown as GeolocationPosition);
        }, 40);
      },
      watchPosition() { return 0; },
      clearWatch() {},
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => geolocation });
  }, behavior);
}

async function routeOpenPoi(page: Page, handlers: { search?: unknown; suggest?: unknown; status?: number } = {}) {
  const requests: Request[] = [];
  await page.context().route('https://api.openpoiapi.com/**', async (route) => {
    const request = route.request();
    requests.push(request);
    const url = new URL(request.url());
    const status = handlers.status ?? 200;
    const body = url.pathname === '/v1/search' ? handlers.search ?? nearbyBody : url.pathname === '/v1/suggest' ? handlers.suggest : undefined;
    if (body === undefined && status === 200) return route.fulfill({ status: 500, body: '{}' });
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body ?? {}) });
  });
  return requests;
}

async function openExpenseDialog(page: Page, actor = '') {
  await page.goto(`/budget${actor}`);
  await page.getByRole('button', { name: '支出を追加' }).click();
  await expect(page.getByRole('dialog', { name: 'すぐに追加' })).toBeVisible();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'すぐに追加' });

test('owner attaches a nearby place from the current location; only a rounded center leaves the device', async ({ page }) => {
  await stubGeolocation(page, { coords: POSITION });
  const requests = await routeOpenPoi(page);
  await openExpenseDialog(page);
  const d = dialog(page);
  await d.getByLabel('支出名').fill('ノートと鉛筆');
  await d.getByLabel('金額（円）').fill('480');
  await d.getByRole('button', { name: '場所を追加（任意）' }).click();
  await d.getByRole('button', { name: '現在地', exact: true }).click();
  await d.getByRole('button', { name: '現在地から探す' }).click();
  await expect(d.getByText('外部の検索サービスを使います')).toBeVisible();
  await expect(d.getByRole('button', { name: '同意して続ける' })).toBeFocused();
  expect(requests).toHaveLength(0);
  await d.getByRole('button', { name: '同意して続ける' }).click();
  const candidates = d.locator('.place-candidates button');
  await expect(candidates).toHaveCount(3);
  await expect(candidates.nth(0)).toBeFocused();
  await expect(candidates.nth(0)).toContainText('みどり文具店');
  await expect(candidates.nth(0)).toContainText('すぐ近く');
  await expect(candidates.nth(1)).toContainText('こもれびベーカリー');
  await expect(d.getByRole('link', { name: /OpenPOI API/ })).toHaveAttribute('href', 'https://openpoiapi.com/attribution.html');

  expect(requests).toHaveLength(1);
  const url = new URL(requests[0].url());
  expect(url.searchParams.get('center')).toBe('139.669,35.644');
  expect(url.searchParams.get('limit')).toBe('200');
  expect(requests[0].url()).not.toContain('35.64375');
  expect(requests[0].url()).not.toContain('139.66915');
  expect(await requests[0].headerValue('referer')).toBeNull();
  expect(await requests[0].headerValue('cookie')).toBeNull();

  await candidates.nth(0).click();
  await expect(d.getByText('みどり文具店')).toBeVisible();
  await expect(d.getByRole('button', { name: '場所を変更' })).toBeFocused();
  await d.getByRole('button', { name: '追加する' }).click();
  await expect(page.getByRole('dialog', { name: 'すぐに追加' })).toBeHidden();
  await expect(page.locator('.list-row').filter({ hasText: 'ノートと鉛筆' }).locator('.place-chip')).toHaveText('みどり文具店');
  await expect(page.locator('[data-control-id="place.attribution.budget"]')).toBeVisible();
});

for (const [label, behavior, message] of [
  ['denied', { errorCode: 1 }, '位置情報の利用が許可されていません'],
  ['timeout', { errorCode: 3 }, '現在地の確認に時間がかかっています'],
  ['coarse (Precise Location off)', { coords: { ...POSITION, accuracy: 4800 } }, 'おおよその位置しか分からない'],
] as const) {
  test(`current location ${label} explains why and offers search and manual entry`, async ({ page }) => {
    await stubGeolocation(page, behavior);
    const requests = await routeOpenPoi(page);
    await openExpenseDialog(page);
    const d = dialog(page);
    await d.getByRole('button', { name: '場所を追加（任意）' }).click();
    await d.getByRole('button', { name: '現在地', exact: true }).click();
    await d.getByRole('button', { name: '現在地から探す' }).click();
    await d.getByRole('button', { name: '同意して続ける' }).click();
    await expect(d.getByRole('alert')).toContainText(message);
    await expect(d.getByRole('button', { name: '手入力にする' })).toBeVisible();
    await expect(page.locator('body')).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.closest('.place-picker') !== null)).toBe(true);
    if (label.startsWith('coarse')) await expect(d.getByLabel('お店や場所の名前')).toBeVisible();
    else await expect(d.getByRole('button', { name: '名前で探す' }).last()).toBeVisible();
    expect(requests).toHaveLength(0);
  });
}

test('photo location is read on the device; photos without location explain how to keep it', async ({ page }) => {
  const requests = await routeOpenPoi(page);
  await openExpenseDialog(page);
  const d = dialog(page);
  await d.getByRole('button', { name: '場所を追加（任意）' }).click();
  await d.getByRole('button', { name: '写真から', exact: true }).click();
  await d.getByRole('button', { name: '写真を選ぶ' }).click();
  const chooser = page.waitForEvent('filechooser');
  await d.getByRole('button', { name: '同意して続ける' }).click();
  await (await chooser).setFiles({ name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(buildJpegWithGps({ lat: POSITION.latitude, lng: POSITION.longitude, takenAt: { date: '2026:09:29', time: [9, 15, 0] } })) });
  await expect(d.locator('.place-candidates button').first()).toContainText('みどり文具店');
  await expect(d.getByText(/撮影日時: 2026年9月29日 18:15/)).toBeVisible();
  expect(requests).toHaveLength(1);
  for (const request of requests) expect(request.postData()).toBeNull();

  const second = page.waitForEvent('filechooser');
  await d.getByRole('button', { name: '写真を選ぶ' }).click();
  await (await second).setFiles({ name: 'screenshot.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(buildJpegWithoutGps()) });
  await expect(d.getByRole('alert')).toContainText('この写真には位置情報が残っていません');
  await expect(d.getByRole('alert')).toContainText('オプション');
  expect(requests).toHaveLength(1);
});

test('name search shows nationwide fallback, and manual entry still works when the service fails', async ({ page }) => {
  await routeOpenPoi(page, { suggest: { count: 1, scope: 'nationwide', suggestions: [facility('とおくの朝市', 41.77, 140.72)], licenses: [], attributions: [] } });
  await openExpenseDialog(page);
  const d = dialog(page);
  await d.getByRole('button', { name: '場所を追加（任意）' }).click();
  await d.getByRole('button', { name: '名前で探す', exact: true }).click();
  await d.getByLabel('お店や場所の名前').fill('朝市');
  await expect(d.getByRole('button', { name: '検索' })).toBeEnabled();
  await d.getByLabel('お店や場所の名前').press('Enter');
  await d.getByRole('button', { name: '同意して続ける' }).click();
  await expect(d.locator('.place-candidates button')).toContainText('とおくの朝市');

  await page.context().unroute('https://api.openpoiapi.com/**');
  await routeOpenPoi(page, { status: 503 });
  await d.getByRole('button', { name: '検索' }).click();
  await expect(d.getByRole('alert')).toContainText('場所の検索サービスから応答がありません');
  await d.getByRole('button', { name: '手入力にする' }).click();
  await d.getByLabel('場所の名前').fill('祖母の家');
  await d.getByRole('button', { name: 'この場所にする' }).click();
  await expect(d.getByText('祖母の家')).toBeVisible();
  await d.getByLabel('支出名').fill('手土産');
  await d.getByLabel('金額（円）').fill('1200');
  await d.getByRole('button', { name: '追加する' }).click();
  await expect(page.locator('.list-row').filter({ hasText: '手土産' }).locator('.place-chip')).toHaveText('祖母の家');
});

test('children never see recorded places or the picker; owners do', async ({ page }) => {
  await page.goto('/notes/memo-school');
  await expect(page.getByRole('heading', { name: '場所', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('青葉小学校 体育館', { exact: true })).toBeVisible();
  await page.goto('/notes/memo-school?actor=member-hana');
  await expect(page.getByRole('dialog').getByText('受付 9:15〜')).toBeVisible();
  await expect(page.getByRole('heading', { name: '場所', exact: true })).toHaveCount(0);
  await expect(page.getByText('青葉小学校 体育館')).toHaveCount(0);
  await page.goto('/notes?actor=member-hana');
  await page.getByRole('button', { name: 'メモを追加' }).click();
  await expect(page.getByRole('button', { name: '場所を追加（任意）' })).toHaveCount(0);
  await page.goto('/settings/location?actor=member-hana');
  await expect(page.getByRole('heading', { name: 'このページは表示できません' })).toBeVisible();
});

test('owner attaches and removes a place on a memo', async ({ page }) => {
  await page.goto('/notes/memo-clinic');
  await page.getByRole('button', { name: '内容を編集' }).click();
  const edit = page.getByRole('dialog', { name: 'メモを編集' });
  await edit.getByRole('button', { name: '場所を追加（任意）' }).click();
  await edit.getByRole('button', { name: '手入力', exact: true }).click();
  await edit.getByLabel('場所の名前').fill('こもれび小児科');
  await edit.getByLabel('場所の名前').press('Enter');
  await expect(edit.getByText('こもれび小児科')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'メモを編集' })).toBeVisible();
  await edit.getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('heading', { name: '場所', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '小児科の控え' })).toContainText('こもれび小児科');
  await page.getByRole('button', { name: '内容を編集' }).click();
  await page.getByRole('dialog', { name: 'メモを編集' }).getByRole('button', { name: '場所を外す' }).click();
  await page.getByRole('dialog', { name: 'メモを編集' }).getByRole('button', { name: '変更を保存' }).click();
  await expect(page.getByRole('heading', { name: '場所', exact: true })).toHaveCount(0);
});

test('revoking consent in settings makes the next lookup ask again', async ({ page }) => {
  await routeOpenPoi(page, { suggest: { count: 0, scope: 'view', suggestions: [] } });
  await page.goto('/settings/location');
  await expect(page.getByRole('heading', { name: '位置情報と外部への送信' })).toBeVisible();
  await expect(page.getByText('OpenPOI API（日本国内のお店や施設のデータを提供する外部サービス）')).toBeVisible();
  const toggle = page.getByRole('button', { name: '外部の検索サービスを使う' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'すぐに追加' }).click();
  const d = dialog(page);
  await d.getByRole('button', { name: '支出', exact: true }).click();
  await d.getByRole('button', { name: '場所を追加（任意）' }).click();
  await d.getByRole('button', { name: '名前で探す', exact: true }).click();
  await d.getByLabel('お店や場所の名前').fill('カフェ');
  await d.getByRole('button', { name: '検索' }).click();
  await expect(d.getByText('外部の検索サービスを使います')).toBeVisible();
});

test('expanded picker controls all carry ids and accessible names, and Escape closes only the picker', async ({ page }) => {
  await stubGeolocation(page, { coords: POSITION });
  await routeOpenPoi(page);
  await openExpenseDialog(page);
  const d = dialog(page);
  await d.getByRole('button', { name: '場所を追加（任意）' }).click();
  await d.getByRole('button', { name: '現在地', exact: true }).click();
  await d.getByRole('button', { name: '現在地から探す' }).click();
  await d.getByRole('button', { name: '同意して続ける' }).click();
  await expect(d.locator('.place-candidates button')).toHaveCount(3);
  const controls = await d.locator('button:visible, a[href]:visible, input:visible, select:visible, textarea:visible').evaluateAll((elements) => elements.map((element) => ({
    id: (element as HTMLElement).dataset.controlId, name: element.getAttribute('aria-label') || element.textContent?.trim() || (element as HTMLInputElement).labels?.[0]?.textContent?.trim(),
  })));
  expect(controls.filter((item) => !item.id || !item.name)).toEqual([]);
  expect(new Set(controls.map((item) => item.id)).size).toBe(controls.length);
  await d.locator('.place-candidates button').first().focus();
  await page.keyboard.press('Escape');
  await expect(d).toBeVisible();
  await expect(d.getByRole('button', { name: '場所を追加（任意）' })).toBeFocused();
});
