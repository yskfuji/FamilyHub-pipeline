import { expect, test } from '@playwright/test';
import { failOnCspViolation, PASSWORD, signIn } from './support';

test('a signed-out visitor is sent to sign in, and fixture data never appears', async ({ page }) => {
  await page.goto('/today');
  await expect(page).toHaveURL(/\/auth/);
  expect(await page.content()).not.toContain('学校公開');
});

test('wrong credentials are refused with the same message', async ({ page }) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'パスワードでサインイン' }).click();
  await page.getByLabel('メールアドレス').fill('aoi@example.test');
  await page.getByLabel('パスワード', { exact: true }).fill('not-the-right-password');
  await page.getByRole('button', { name: 'サインイン', exact: true }).click();
  await expect(page.getByText('メールアドレスまたはパスワードが正しくありません。')).toBeVisible();
});

test('signing in loads the household from the API, keeps it after reload, and creates records under CSP', async ({ page }) => {
  const violations = failOnCspViolation(page);
  await signIn(page);
  await page.goto('/notes');
  await expect(page.getByText('学校公開のお知らせ').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('学校公開のお知らせ').first()).toBeVisible();
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'タスクを追加' }).click();
  await page.getByRole('dialog').getByLabel('タスク名').fill('実スタックのタスク');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  await expect(page.getByText('実スタックのタスク').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('実スタックのタスク').first()).toBeVisible();
  expect(violations).toEqual([]);
});

test('roles are enforced by the server: a child sees no budget even by asking the API', async ({ page }) => {
  await signIn(page, 'hana@example.test', PASSWORD);
  const snapshot = await page.evaluate(async () => (await fetch('/v1/households/current/snapshot', { credentials: 'include' })).json());
  expect(snapshot.expenses).toEqual([]);
  const denied = await page.evaluate(async () => {
    const { token } = await (await fetch('/v1/auth/csrf', { credentials: 'include' })).json();
    return (await fetch('/v1/expenses', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ title: 'x', amountJpy: 1, incurredOn: '2026-09-30', payerMembershipId: 'member-hana', shareMembershipIds: ['member-hana'] }) })).status;
  });
  expect(denied).toBe(403);
});

test('a passkey registered in settings signs in with a virtual authenticator', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await signIn(page, 'ren@example.test', PASSWORD);
  await page.goto('/settings/security');
  await page.getByRole('button', { name: '別のパスキーを追加' }).click();
  await expect(page.getByText('パスキー').first()).toBeVisible();
  await page.getByRole('button', { name: 'この端末からサインアウト' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'サインアウト' }).click();
  await page.goto('/auth');
  await page.getByRole('button', { name: 'パスキーでサインイン' }).click();
  await expect(page).toHaveURL(/\/today/);
});
