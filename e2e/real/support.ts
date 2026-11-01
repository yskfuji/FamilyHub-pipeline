import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const PASSWORD = 'current-password-long-enough';

export async function signIn(page: Page, email = 'aoi@example.test', password = PASSWORD) {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'パスワードでサインイン' }).click();
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'サインイン', exact: true }).click();
  await expect(page).toHaveURL(/\/today/);
}

/** CSP の違反を試験の失敗にする。 */
export function failOnCspViolation(page: Page) {
  const violations: string[] = [];
  page.on('console', (message) => { if (/Content.Security.Policy/i.test(message.text())) violations.push(message.text()); });
  return violations;
}
