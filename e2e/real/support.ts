import { expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

export const PASSWORD = 'current-password-long-enough';

export async function signIn(page: Page, email = 'aoi@example.test', password = PASSWORD) {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'パスワードでサインイン' }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'サインイン', exact: true }).click();
  await expect(page).toHaveURL(/\/today/);
}

type SavedSession = Awaited<ReturnType<BrowserContext['storageState']>>;
const sessions = new Map<string, SavedSession>();

/**
 * 同じ人で何度もサインインすると、推測を防ぐ上限（同じメールで15分に10回、server/http/routes/auth.ts）に届く。
 * 上限は緩めず、同じ人の試験では一度のサインインを使い回す（workers: 1 なので、同じ工程の中で共有できる）。
 * 使い回したサインインが切れていれば、サインインし直す。
 */
export async function signInOnce(page: Page, email = 'aoi@example.test', password = PASSWORD) {
  const saved = sessions.get(email);
  if (saved) {
    await page.context().addCookies(saved.cookies);
    await page.goto('/today');
    await page.locator('html[data-route-ready]').waitFor({ state: 'attached' });
    if (new URL(page.url()).pathname === '/today') return;
  }
  await signIn(page, email, password);
  sessions.set(email, await page.context().storageState());
}

/** CSP の違反を試験の失敗にする。 */
export function failOnCspViolation(page: Page) {
  const violations: string[] = [];
  page.on('console', (message) => { if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text()); });
  return violations;
}
