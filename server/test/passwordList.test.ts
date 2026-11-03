import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkNewPassword, normalizePassword } from '../../src/domain/passwordPolicy';

const domain = resolve(import.meta.dirname, '../../src/domain');
const listText = readFileSync(resolve(domain, 'commonPasswords.json'), 'utf8');

describe('the bundled common-password list (A9-1, A9-4)', () => {
  it('is the recorded file: normalised, 15 to 64 characters, without duplicates', () => {
    // 出典と作り方は scripts/build-password-list.mjs と docs/acceptance/evidence.md §7。
    expect(createHash('sha256').update(listText).digest('hex')).toBe('4816280f240d5d7934ee3bb63eea1be68b46ee6e0634929e7c7c649a1d92783f');
    const entries = JSON.parse(listText) as string[];
    expect(entries).toHaveLength(5317);
    expect(new Set(entries).size).toBe(entries.length);
    expect(entries.filter((entry) => entry !== normalizePassword(entry) || entry.length < 15 || entry.length > 64)).toEqual([]);
  });

  it('is rejected in full by the check the API uses', async () => {
    const entries = JSON.parse(listText) as string[];
    const accepted: string[] = [];
    for (const entry of entries) if (await checkNewPassword(entry) === null) accepted.push(entry);
    expect(accepted).toEqual([]);
  });

  it('is loaded on demand in the browser, not with the first screen', () => {
    for (const file of ['passwordPolicy.ts', 'schemas.ts', 'account.ts']) {
      expect(readFileSync(resolve(domain, file), 'utf8')).not.toMatch(/^import[^;]*commonPasswords/m);
    }
    expect(readFileSync(resolve(domain, 'passwordPolicy.ts'), 'utf8')).toContain("import('./commonPasswords.json')");
  });
});
