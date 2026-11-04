import { describe, expect, it } from 'vitest';
import { passwordMessages } from '../content/passwordMessages';
import entries from './commonPasswords.json';
import { checkNewPassword, hasWeakPattern, loadCommonPasswords, matchesContext, passwordProblem } from './passwordPolicy';
import { currentPasswordSchema, passwordSchema } from './schemas';

/** 一覧のファイルそのものの確認（sha256・長さ・読み込みの遅延）は server/test/passwordList.test.ts。 */
describe('the bundled common-password list (A9-1, A9-5)', () => {
  it('rejects every entry, also when typed in capitals or full width', async () => {
    const list = await loadCommonPasswords();
    expect(list.size).toBe(entries.length);
    const accepted = entries.filter((entry) => passwordProblem(entry, { commonPasswords: list }) === null);
    expect(accepted).toEqual([]);
    expect(passwordProblem('ManchesterUnited', { commonPasswords: list })).toBe('common');
    expect(passwordProblem('ｍａｎｃｈｅｓｔｅｒｕｎｉｔｅｄ', { commonPasswords: list })).toBe('common');
    expect(await checkNewPassword('transportonline')).toBe(passwordMessages.common);
  });
});

describe('context words (A9-2)', () => {
  const context = { email: 'aoi.mori@example.test', displayName: '森 碧', householdName: '森さんち' };
  it.each([
    'よりどころ1234567890',
    'yoridokoro2026!!!!!',
    'YORIDOKORO-2026-09-30',
    'ｙｏｒｉｄｏｋｏｒｏ２０２６！！！！',
    'yoridokoroyoridokoro',
    'aoi.mori1234567890',
    'AOIMORI_1990_04_01',
    '森碧1234567890123',
    '森 碧 2026 09 30 !!',
    '森さんち1234567890!',
    '森さんち森さんち森さんち森さんち',
  ])('rejects %s', (value) => {
    expect(matchesContext(value, context)).toBe(true);
    expect(passwordProblem(value, { context })).toBe('context');
  });

  it('keeps a passphrase that only contains a context word', () => {
    expect(passwordProblem('森さんちの夏休みは海へ行く予定です', { context })).toBeNull();
    expect(passwordProblem('aoi-likes-green-tea-in-winter', { context })).toBeNull();
  });
});

describe('patterns (A9-3)', () => {
  it.each([
    'aaaaaaaaaaaaaaaa',
    'ああああああああああああああああ',
    'passwordpassword',
    'abcabcabcabcabcabc',
    '123456789012345',
    '987654321098765',
    'abcdefghijklmnop',
    'zyxwvutsrqponmlk',
    'qwertyuiopasdfg',
    'poiuytrewqlkjhgf',
    '1qaz2wsx3edc4rfv',
    '1q2w3e4r5t6y7u8i',
    'qwerty123456789',
    '!@#$%^&*()_+!@#$',
    'asdf ghjk l;asdf',
  ])('rejects %s', (value) => {
    expect(hasWeakPattern(value)).toBe(true);
    expect(passwordSchema.safeParse(value).success).toBe(false);
  });
});

describe('ordinary long passphrases (A9-5)', () => {
  it.each([
    '家族で決めた十分に長い合言葉です',
    'correct horse battery staple',
    'new-family-password-2026',
    'a-brand-new-password-here',
    'みかんの木の下で猫が三匹ねむる',
    'Tea at 3pm with grandma on Sundays',
  ])('accepts %s', async (value) => {
    expect(passwordSchema.safeParse(value).success).toBe(true);
    expect(await checkNewPassword(value, { email: 'aoi@example.test', displayName: '碧', householdName: '森さんち' })).toBeNull();
  });

  it('checks only the length of the current password at sign-in', () => {
    expect(currentPasswordSchema.safeParse('123456789012345').success).toBe(true);
    expect(currentPasswordSchema.safeParse('short').success).toBe(false);
  });
});
