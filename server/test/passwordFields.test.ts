import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 画面のパスワードの欄（A9-5、WCAG 3.3.8、ASVS 6.2.7）。貼り付けと保存の仕組みを妨げないこと。 */
const root = resolve(import.meta.dirname, '../..');
const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
const screens = filesUnder(resolve(root, 'src')).filter((file) => file.endsWith('.tsx')).map((file) => ({ path: relative(root, file), text: readFileSync(file, 'utf8') }));

describe('password fields', () => {
  const fields = screens.flatMap((file) => [...file.text.matchAll(/<input[^>]*type="password"[^>]*>/g)].map((match) => ({ path: file.path, tag: match[0] })));

  it('exist on every screen that asks for a password', () => {
    expect(new Set(fields.map((field) => field.path))).toEqual(new Set(['src/app/reauth.tsx', 'src/features/auth/AuthPage.tsx', 'src/features/auth/ResetPasswordPage.tsx', 'src/features/auth/SignUpPage.tsx', 'src/features/settings/SettingsPage.tsx']));
  });

  it('say whether they hold the current or a new password', () => {
    for (const field of fields) expect(field.tag, field.path).toMatch(/autoComplete="(current-password|new-password)"/);
    const purpose = (name: string) => fields.find((field) => field.tag.includes(`name="${name}"`) || field.tag.includes(`id="${name}"`))?.tag.match(/autoComplete="([^"]+)"/)?.[1];
    expect(purpose('signup-password')).toBe('new-password');
    expect(purpose('reset-password')).toBe('new-password');
    expect(purpose('next')).toBe('new-password');
    expect(purpose('confirm')).toBe('new-password');
    expect(purpose('current')).toBe('current-password');
    expect(purpose('reauth-password')).toBe('current-password');
  });

  it('never block paste, copy or cut', () => {
    for (const file of screens) expect(file.text, file.path).not.toMatch(/onPaste|onCopy|onCut|addEventListener\(['"](paste|copy|cut)['"]/);
  });
});
