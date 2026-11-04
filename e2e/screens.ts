import { expect, type Page } from '@playwright/test';

/**
 * 撮影一覧（e2e/capture.spec.ts）の画面と状態。濃さの確かめ（e2e/contrast.spec.ts）も同じ一覧を使う。
 * [名前, 経路]。名前は画像の名前になる（scripts/build-gallery.mjs が日本語にする）。
 */
export const screens = [
  ['welcome','/welcome'],['auth','/auth'],['onboarding','/onboarding'],['today','/today'],['calendar','/calendar'],['tasks','/tasks'],['notes','/notes'],['budget','/budget'],['albums','/albums'],['albums-detail','/albums/album-sports'],['insights','/insights'],['settings-household','/settings/household'],['settings-security','/settings/security'],['settings-notifications','/settings/notifications'],['settings-accessibility','/settings/accessibility'],['settings-resources','/settings/resources'],['settings-location','/settings/location'],['showcase','/showcase'],['management','/showcase/management'],['management-jobs','/showcase/management/jobs'],
  ['today-empty','/today?scenario=empty'],['today-offline','/today?scenario=offline'],['today-conflict','/today?scenario=conflict'],['today-expired-session','/today?scenario=expired-session'],['today-weather','/today?scenario=weather'],['notes-quarantined','/notes/memo-school?scenario=quarantined'],['showcase-expired-invite','/showcase?scenario=expired-invite'],
  ['budget-list','/budget?view=list'],['budget-members','/budget?view=members'],['budget-settlements','/budget?view=settlements'],['budget-detail','/budget/expense-books'],['places','/places'],['settings-recently-deleted','/settings/recently-deleted'],['settings-help','/settings/help'],['settings-legal','/settings/legal'],['places-detail','/places/550c29b2'],['calendar-occurrence','/calendar/event-clean?month=2026-10&on=2026-10-08'],['tasks-recurring','/tasks/todo-garbage'],['settings-privacy','/settings/privacy'],['not-found','/todayx'],
  ['today-child','/today?actor=member-hana'],['calendar-child','/calendar?actor=member-hana'],['today-guest','/today?actor=member-yui'],['resources-guest','/settings/resources?actor=member-yui'],['household-adult','/settings/household?actor=member-ren'],['household-forbidden-guest','/settings/household?actor=member-yui'],
  // 段階9: 変更の記録（家族・自分・絞り込みで空・大人には出ない）、管理者が2人の家族、撮影日順、まとめて精算できる人の精算の画面。
  ['settings-audit','/settings/audit'],['settings-audit-mine','/settings/audit?view=mine'],['settings-audit-empty','/settings/audit?kind=assistant&period=today'],['settings-audit-forbidden-adult','/settings/audit?actor=member-ren'],
  ['household-two-owners','/settings/household?household=two-owners'],['albums-detail-taken','/albums/album-sports?sort=taken'],['budget-settlements-ren','/budget?view=settlements&actor=member-ren'],
  // 段階10: 挿絵のある空の状態（予定・タスク・メモ・家計・アルバム・場所・オフライン・全部済んだ）、追加できない人の空の状態、
  // 今日の画面の季節（秋は today）と全部済んだ夜。検索で見つからない・エラー・はじめにの2と3は下の openedStates。
  ['calendar-empty','/calendar?view=list&scenario=empty'],['tasks-empty','/tasks?scenario=empty'],['tasks-empty-guest','/tasks?scenario=empty&actor=member-yui'],['tasks-all-done','/tasks?scenario=all-done'],
  ['notes-empty','/notes?scenario=empty'],['budget-empty','/budget?scenario=empty'],['albums-empty','/albums?scenario=empty'],['places-empty','/places?scenario=empty'],
  ['offline-unreachable','/today?stage=unreachable'],['today-all-done','/today?scenario=all-done'],
  ['today-spring','/today?season=spring'],['today-summer','/today?season=summer'],['today-winter','/today?season=winter'],
  // 段階11: 図表。推移の記録が1か月だけの月（文で伝える）と、表示する人で絞った蓮さんの家計（収入の面が消える）。
  // 費目・推移は budget、差し引きは budget-settlements と budget-settlements-ren、日ごとの件数は insights に写る。表は下の openedStates。
  ['budget-trend-short','/budget?month=2026-08'],['budget-ren','/budget?actor=member-ren'],
] as const;

export const viewports = [
  ['mobile',390,844],['tablet',834,1112],['desktop',1440,1000],
] as const;

export type ViewportName = typeof viewports[number][0];

/** 操作して開く状態（重ね表示など）。open は開いたことを確かめてから戻る。 */
export interface OpenedState {
  name: string;
  route: string;
  viewports: readonly ViewportName[];
  open(page: Page): Promise<void>;
}

export const openedStates: readonly OpenedState[] = [
  { name: 'notification-center', route: '/today', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: /通知を確認/ }).click();
    await expect(page.getByRole('heading', { name: '通知', exact: true })).toBeVisible();
  } },
  { name: 'calendar-edit', route: '/calendar/event-clean', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '編集する' }).click();
    await expect(page.getByRole('heading', { name: '予定を編集' })).toBeVisible();
  } },
  { name: 'settings-permission', route: '/settings/household', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '権限' }).nth(1).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } },
  { name: 'settings-password', route: '/settings/security', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: 'パスワードを変更' }).click();
    await expect(page.getByRole('heading', { name: 'パスワードを変更' })).toBeVisible();
  } },
  { name: 'more-menu', route: '/budget', viewports: ['mobile'], async open(page) {
    await page.getByRole('button', { name: /^その他/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } },
  // 段階9の重ね表示と、操作したあとの状態。
  { name: 'budget-settle-all', route: '/budget?view=settlements&actor=member-ren', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: 'まとめて精算する' }).click();
    await expect(page.getByRole('dialog', { name: 'まとめて精算しますか' })).toBeVisible();
  } },
  { name: 'budget-settle-all-refused', route: '/budget?view=settlements', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: 'まとめて精算する' }).click();
    await page.getByRole('button', { name: '精算を記録する' }).click();
    await expect(page.getByRole('dialog', { name: 'まとめて精算しますか' }).getByRole('alert')).toBeVisible();
  } },
  { name: 'budget-batch-history', route: '/budget?view=settlements&actor=member-ren', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: 'まとめて精算する' }).click();
    await page.getByRole('button', { name: '精算を記録する' }).click();
    const row = page.locator('.batch-row');
    await expect(row).toBeVisible();
    await row.locator('summary').click();
    await row.scrollIntoViewIfNeeded();
  } },
  { name: 'budget-kind-change', route: '/budget/expense-books', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '内容を編集' }).click();
    await page.getByRole('radio', { name: '収入' }).check();
    await expect(page.getByRole('dialog', { name: '支出を編集' }).getByRole('status').first()).toBeVisible();
  } },
  { name: 'attachment-pdf', route: '/notes/memo-school', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '学校公開.pdfを開く', exact: true }).click();
    await expect(page.locator('.pdf-page[data-drawn="true"]')).toBeVisible({ timeout: 15_000 });
  } },
  { name: 'attachment-image', route: '/notes/memo-receipt', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '教材の写真.jpgを開く', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '「教材の写真.jpg」を表示' }).getByRole('img')).toBeVisible();
  } },
  { name: 'search-grouped', route: '/today', viewports: ['mobile', 'desktop'], async open(page) {
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.press('Control+K');
    await page.getByRole('searchbox').fill('学校');
    await expect(page.getByRole('heading', { name: /^アルバム/ })).toBeVisible();
  } },
  { name: 'calendar-series-preview', route: '/calendar/event-clean?month=2026-10&on=2026-10-15', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByLabel('対象とする予定').selectOption('series');
    await page.getByRole('button', { name: '編集する' }).click();
    await page.getByLabel('開始', { exact: true }).fill('2026-10-16T08:00');
    const preview = page.locator('[data-series-preview]');
    await expect(preview).toBeVisible();
    await preview.scrollIntoViewIfNeeded();
  } },
  { name: 'calendar-series-refused', route: '/calendar/event-clean?month=2026-10&on=2026-10-01', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByLabel('対象とする予定').selectOption('series');
    await page.getByRole('button', { name: '編集する' }).click();
    await page.getByLabel('繰り返し', { exact: true }).selectOption('monthly');
    await page.getByRole('button', { name: '変更を保存' }).click();
    // 編集の画面は先に閉じ、記録を読み直してから知らせが出る。読み直しを待たずに開くと、前の規則で見通しを作る。
    await expect(page.locator('.toast-visible')).toContainText('更新しました');
    await page.getByLabel('対象とする予定').selectOption('series');
    await page.getByRole('button', { name: '編集する' }).click();
    await page.getByLabel('開始', { exact: true }).fill('2026-09-30T08:00');
    const preview = page.locator('[data-series-preview="refused"]');
    await expect(preview).toBeVisible();
    await preview.scrollIntoViewIfNeeded();
  } },
  { name: 'albums-viewer-taken', route: '/albums/album-sports', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '写真「item-sports-2.jpg」を開く' }).click();
    await page.getByRole('button', { name: '詳しい情報' }).click();
    await expect(page.getByRole('complementary', { name: '詳しい情報' })).toBeVisible();
  } },
  { name: 'settings-leave-co-owner', route: '/settings/household?household=two-owners', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByRole('region', { name: '家族グループから退出' }).getByRole('button', { name: '家族グループから退出' }).click();
    await expect(page.getByRole('dialog', { name: '家族グループから退出しますか' })).toBeVisible();
  } },
  // 段階10: はじめにの2と3、検索で見つからない、経路のエラー境界。
  { name: 'onboarding-sharing', route: '/onboarding', viewports: ['mobile', 'tablet', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '次へ' }).click();
    await expect(page.getByRole('heading', { name: '共有範囲', level: 1, exact: true })).toBeVisible();
  } },
  { name: 'onboarding-welcome', route: '/onboarding', viewports: ['mobile', 'tablet', 'desktop'], async open(page) {
    await page.getByRole('button', { name: '次へ' }).click();
    await expect(page.getByRole('heading', { name: '共有範囲', level: 1, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '次へ' }).click();
    await expect(page.getByRole('heading', { name: 'ようこそ、よりどころへ' })).toBeVisible();
  } },
  { name: 'search-empty', route: '/today', viewports: ['mobile', 'desktop'], async open(page) {
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.press('Control+K');
    await page.getByRole('searchbox').fill('見つからない言葉');
    await expect(page.getByRole('heading', { name: '一致する情報はありません' })).toBeVisible();
  } },
  { name: 'notes-search-empty', route: '/notes', viewports: ['mobile', 'desktop'], async open(page) {
    await page.getByLabel('メモを検索').fill('見つからない言葉');
    await expect(page.getByRole('heading', { name: '条件に合うメモはありません' })).toBeVisible();
  } },
  { name: 'route-error', route: '/today', viewports: ['mobile', 'tablet', 'desktop'], async open(page) {
    // 段階8の FRAME-3 と同じく、ヒントの画面の部品を描けない部品に差し替えてから、アプリの中で移る。
    const chunk = '**/assets/InsightsPage-*.js';
    await page.route(chunk, (route) => route.fulfill({ contentType: 'text/javascript', body: 'export function InsightsPage() { throw new Error("injected render failure"); }' }));
    await page.evaluate(() => { window.history.pushState({}, '', '/insights'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.locator('.route-error').getByRole('heading', { name: 'この画面を表示できませんでした' })).toBeVisible();
    await page.unroute(chunk);
  } },
  // 段階11: 図表の「表で見る」を開いた状態。
  { name: 'budget-trend-table', route: '/budget', viewports: ['mobile', 'tablet', 'desktop'], async open(page) {
    const trend = page.locator('[data-chart="trend"]');
    await trend.getByRole('button', { name: '表で見る' }).click();
    await expect(trend.getByRole('table')).toBeVisible();
    await trend.getByRole('table').scrollIntoViewIfNeeded();
  } },
  { name: 'budget-balances-table', route: '/budget?view=settlements', viewports: ['mobile', 'desktop'], async open(page) {
    const balances = page.locator('[data-chart="balances"]');
    await balances.getByRole('button', { name: '表で見る' }).click();
    await expect(balances.getByRole('table')).toBeVisible();
    await balances.scrollIntoViewIfNeeded();
  } },
  { name: 'insights-week-table', route: '/insights', viewports: ['mobile', 'desktop'], async open(page) {
    const week = page.locator('[data-chart="week-load"]');
    await week.getByRole('button', { name: '表で見る' }).click();
    await expect(week.getByRole('table')).toBeVisible();
    await week.getByRole('table').scrollIntoViewIfNeeded();
  } },
  { name: 'quick-create-expense', route: '/budget', viewports: ['mobile'], async open(page) {
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.getByRole('button', { name: '家計', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } },
];
