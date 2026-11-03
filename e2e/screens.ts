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
  { name: 'quick-create-expense', route: '/budget', viewports: ['mobile'], async open(page) {
    await page.getByRole('button', { name: 'すぐに追加' }).click();
    await page.getByRole('button', { name: '家計', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } },
];
