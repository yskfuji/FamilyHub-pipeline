import { passwordMessages } from '../content/passwordMessages';

/**
 * 新しいパスワードの規則。画面・確認用データ・API で共有する（NIST SP 800-63B-4 3.1.1.2）。
 *
 * - 長さは15〜64文字。文字種の指定はしない。
 * - 頻出の一覧（commonPasswords.json）と全体で比べる。一覧は SecLists（Daniel Miessler ほか、MIT License）の
 *   Passwords/Common-Credentials/Pwdb_top-1000000.txt（commit 35d74839e66f44d116e694369d86a5bf07aaed6f、
 *   sha256 e9a88f67aafe65496682dc374559ee714e978bee50314767494c3e37a18c9fc8）を NFKC と小文字にそろえ、15〜64文字の項目に絞ったもの。
 *   作り方は scripts/build-password-list.mjs、記録は docs/acceptance/evidence.md の §7。
 * - サービス名・メールアドレスの @ より前・表示名・家族グループの名前をもとにしたものを拒否する。
 * - 同じ文字や短いまとまりの繰り返し、数字・文字・キーボードの並びだけのものを拒否する。
 *
 * 漏えいしたパスワードの照会（Have I Been Pwned など）は、入力の一部を外部へ送ることになるので使わない。
 * 一覧は画面では遅れて読み込み、最初の表示の読み込みに入れない。
 */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 64;

export type PasswordProblem = 'tooShort' | 'tooLong' | 'common' | 'context' | 'pattern';

export interface PasswordContext {
  email?: string | null;
  displayName?: string | null;
  householdName?: string | null;
}

export const normalizePassword = (value: string) => value.normalize('NFKC').toLowerCase();
/** 数字・記号・空白を除いた形。文脈の語との比較に使う。 */
const lettersOnly = (value: string) => normalizePassword(value).replace(/[\p{N}\p{P}\p{S}\p{Z}\s]/gu, '');

/** 隣り合う文字の並び。どちら向きでも並びとみなす。数字は 9 の次に 0 へ戻る。 */
const sequences = [
  '01234567890',
  'abcdefghijklmnopqrstuvwxyz',
  '`1234567890-=',
  '~!@#$%^&*()_+',
  'qwertyuiop[]\\',
  "asdfghjkl;'",
  'zxcvbnm,./',
  'qwertyuiopasdfghjklzxcvbnm',
  '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,9ol.0p;/',
  'qazwsxedcrfvtgbyhnujmikolp',
  '1q2w3e4r5t6y7u8i9o0p',
  'q1w2e3r4t5y6u7i8o9p0',
  'a1s2d3f4g5h6j7k8l9',
  'z1x2c3v4b5n6m7',
];
const neighbours = new Set<string>();
for (const sequence of sequences) {
  const characters = [...sequence];
  for (let index = 0; index + 1 < characters.length; index += 1) {
    neighbours.add(characters[index] + characters[index + 1]);
    neighbours.add(characters[index + 1] + characters[index]);
  }
}

/** 短いまとまり（8文字以下）の繰り返しでできているか。1文字の繰り返しを含む。 */
function repeatsShortUnit(characters: string[]) {
  for (let size = 1; size <= Math.min(8, Math.floor(characters.length / 2)); size += 1) {
    if (characters.every((character, index) => character === characters[index % size])) return true;
  }
  return false;
}

/** 隣り合う文字のほとんどが同じ文字か並びの隣どうしか。途中で1回だけ並びを替えたもの（qwerty123456789 など）も含める。 */
function followsSequences(characters: string[]) {
  let breaks = 0;
  for (let index = 0; index + 1 < characters.length; index += 1) {
    const pair = characters[index] + characters[index + 1];
    if (characters[index] !== characters[index + 1] && !neighbours.has(pair)) breaks += 1;
    if (breaks > 1) return false;
  }
  return true;
}

export function hasWeakPattern(value: string) {
  const characters = [...normalizePassword(value).replace(/\s+/gu, '')];
  if (characters.length === 0) return false;
  return repeatsShortUnit(characters) || followsSequences(characters);
}

export function contextWords(context: PasswordContext = {}) {
  const local = context.email ? context.email.split('@')[0] : '';
  return [...passwordMessages.serviceWords, local, context.displayName ?? '', context.householdName ?? ''].filter((word) => word.trim() !== '');
}

/** 文脈の語そのもの、数字と記号を除くと文脈の語になるもの、文脈の語を繰り返しただけのものを拒否する。 */
export function matchesContext(value: string, context: PasswordContext = {}) {
  const normalized = normalizePassword(value);
  const letters = lettersOnly(value);
  return contextWords(context).some((word) => {
    if (normalized === normalizePassword(word)) return true;
    const base = lettersOnly(word);
    if (!base || !letters) return false;
    return letters.length % base.length === 0 && letters === base.repeat(letters.length / base.length);
  });
}

export interface PasswordCheck {
  /** 頻出の一覧。省くと一覧との比較をしない（同期の検査で、一覧を読み込む前に使う）。 */
  commonPasswords?: ReadonlySet<string> | null;
  context?: PasswordContext;
}

export function passwordProblem(value: string, check: PasswordCheck = {}): PasswordProblem | null {
  if (value.length < PASSWORD_MIN_LENGTH) return 'tooShort';
  if (value.length > PASSWORD_MAX_LENGTH) return 'tooLong';
  if (check.commonPasswords?.has(normalizePassword(value))) return 'common';
  if (matchesContext(value, check.context)) return 'context';
  if (hasWeakPattern(value)) return 'pattern';
  return null;
}

export const passwordProblemMessage = (problem: PasswordProblem) => passwordMessages[problem];

let commonPasswords: Promise<ReadonlySet<string>> | undefined;
/** 頻出の一覧を読み込む。画面では別のファイルとして必要になったときに読み、最初の表示に含めない。 */
export function loadCommonPasswords(): Promise<ReadonlySet<string>> {
  commonPasswords ??= import('./commonPasswords.json').then((module) => new Set<string>(module.default as string[]));
  return commonPasswords;
}

/** 新しいパスワードを、一覧・文脈・並びのすべてで確かめる。問題がなければ null。 */
export async function checkNewPassword(value: string, context?: PasswordContext): Promise<string | null> {
  const problem = passwordProblem(value, { commonPasswords: await loadCommonPasswords(), context });
  return problem ? passwordProblemMessage(problem) : null;
}
