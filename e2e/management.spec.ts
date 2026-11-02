import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';

/** 管理コンソールの見本。監査用ビルドでだけ開き、どの項目でも見本と分かること。 */
const sections = [
  ['/showcase/management', '概要'],
  ['/showcase/management/services', 'サービスの状態'],
  ['/showcase/management/jobs', 'ジョブ'],
  ['/showcase/management/backups', 'バックアップ'],
  ['/showcase/management/audit-log', '操作の記録'],
  ['/showcase/management/households', '家族グループ'],
  ['/showcase/management/records', '記録の閲覧'],
] as const;

const banner = (page: import('@playwright/test').Page) => page.getByRole('note', { name: '見本の画面です' });

test.describe('audit build', () => {
  for (const [route, heading] of sections) {
    test(`${heading} shows the sample banner`, async ({ page }) => {
      await page.goto(route);
      await expect(banner(page)).toBeVisible();
      await expect(banner(page)).toContainText('見本');
      await expect(banner(page)).toContainText('本物のサーバーや家族の記録には何も届きません');
      await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: '管理コンソールの項目' }).getByRole('link', { name: heading, exact: true })).toHaveAttribute('aria-current', 'page');
    });
  }

  test('an unknown section keeps the banner and offers the way back', async ({ page }) => {
    await page.goto('/showcase/management/unknown');
    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'この項目の見本はありません' })).toBeVisible();
    await page.getByRole('link', { name: '概要に戻る' }).click();
    await expect(page).toHaveURL(/\/showcase\/management$/);
  });

  test('opens from the showcase page and walks through each section without leaving the banner', async ({ page }) => {
    await page.goto('/showcase');
    await page.getByRole('link', { name: '管理コンソールの見本を開く' }).click();
    await expect(page).toHaveURL(/\/showcase\/management$/);
    for (const [, heading] of sections) {
      await page.getByRole('navigation', { name: '管理コンソールの項目' }).getByRole('link', { name: heading, exact: true }).click();
      await expect(banner(page)).toBeVisible();
    }
  });

  test('a job can be tried, confirmed and followed into the log, all on this screen', async ({ page }) => {
    const leaving: string[] = [];
    page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/v1') || request.method() !== 'GET') leaving.push(request.url()); });
    await page.goto('/showcase/management/jobs');
    await page.locator('[data-control-id="showcase.management.job.dry-run.invites"]').click();
    await expect(page.getByRole('status').filter({ hasText: '何も変更していません' })).toBeVisible();
    await expect(page.locator('.mgmt-row').filter({ hasText: '期限切れの招待の片付け' }).first()).toContainText('対象：3件');
    await page.locator('[data-control-id="showcase.management.job.run.invites"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('本物の処理は動いていません');
    await dialog.getByRole('button', { name: 'やめる' }).click();
    await expect(page.locator('.mgmt-row').filter({ hasText: '期限切れの招待の片付け' }).first()).toContainText('対象：3件');
    await page.locator('[data-control-id="showcase.management.job.run.invites"]').click();
    await page.getByRole('dialog').getByRole('button', { name: '見本で実行する' }).click();
    await expect(page.locator('.mgmt-row').filter({ hasText: '期限切れの招待の片付け' }).first()).toContainText('対象：0件');
    await expect(page.locator('[data-control-id="showcase.management.job.run.invites"]')).toBeDisabled();
    await expect(page.locator('[data-control-id="showcase.management.job.run.storage"]')).toHaveCount(0);
    await page.getByRole('navigation', { name: '管理コンソールの項目' }).getByRole('link', { name: '操作の記録', exact: true }).click();
    await page.locator('[data-control-id="showcase.management.audit.filter.job"]').click();
    await expect(page.getByRole('list', { name: '操作の記録' }).locator('li').first()).toContainText('見本の実行：期限切れの招待の片付け');
    await page.locator('[data-control-id="showcase.management.audit.search"]').fill('存在しない言葉');
    await expect(page.getByText('条件に合う記録はありません。')).toBeVisible();
    expect(leaving).toEqual([]);
  });

  test('backups, households and records act on the fixture only', async ({ page }) => {
    await page.goto('/showcase/management/backups');
    await page.locator('[data-control-id="showcase.management.backup.verify.sample-backup-3"]').click();
    await expect(page.locator('.mgmt-row').filter({ hasText: '見本のバックアップ3' })).toContainText('検証済み（見本）');
    await page.locator('[data-control-id="showcase.management.backup.create"]').click();
    await expect(page.locator('.mgmt-row').filter({ hasText: '見本のバックアップ4' })).toContainText('未検証');

    await page.getByRole('navigation', { name: '管理コンソールの項目' }).getByRole('link', { name: '家族グループ', exact: true }).click();
    await page.locator('[data-control-id="showcase.management.household.search"]').fill('家族B');
    await expect(page.getByRole('list', { name: '家族グループ' }).locator('li')).toHaveCount(1);
    await page.locator('[data-control-id="showcase.management.household.stop.sample-household-b"]').click();
    await page.getByRole('dialog').getByRole('button', { name: '見本で止める' }).click();
    await expect(page.locator('.mgmt-row').filter({ hasText: '見本の家族B' })).toContainText('停止中');

    await page.getByRole('navigation', { name: '管理コンソールの項目' }).getByRole('link', { name: '記録の閲覧', exact: true }).click();
    await expect(page.getByRole('list', { name: '記録' }).locator('li')).toHaveCount(1);
    await page.locator('[data-control-id="showcase.management.record.waiting"]').check();
    await expect(page.getByRole('list', { name: '記録' }).locator('li')).toHaveCount(2);
    await page.locator('[data-control-id="showcase.management.record.collection"]').selectOption('expenses');
    await expect(page.getByRole('list', { name: '記録' })).toContainText('（見本では伏せています）');

    await page.reload();
    await page.getByRole('navigation', { name: '管理コンソールの項目' }).getByRole('link', { name: 'バックアップ', exact: true }).click();
    await expect(page.locator('.mgmt-row').filter({ hasText: '見本のバックアップ4' })).toHaveCount(0);
  });
});

// consumer のビルドの中身は、ブラウザに関わらず同じなので1つのブラウザで確かめる。
test.describe('consumer build', () => {
  const base = 'http://127.0.0.1:4175';
  let server: ChildProcess;

  test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for build contents');

  test.beforeAll(async () => {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort', '--outDir', 'dist'], { stdio: 'ignore' });
    await expect(async () => { expect((await fetch(`${base}/today`)).ok).toBe(true); }).toPass({ timeout: 15_000 });
  });

  test.afterAll(() => { server?.kill(); });

  for (const route of ['/showcase/management', '/showcase/management/jobs', '/showcase']) {
    test(`${route} is the not-found page`, async ({ page }) => {
      await page.goto(`${base}${route}`);
      await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
    });
  }
});
