import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashRaw } from '@node-rs/argon2';
import type { Algorithm, Version } from '@node-rs/argon2';
import type { Db } from '../db/db';

/**
 * パスワードのハッシュ（Argon2id、RFC 9106）。計算は @node-rs/argon2 の hashRaw で行い、比較は timingSafeEqual で行う。
 * パラメータは OWASP Password Storage の最低値（m=19MiB, t=2, p=1）より重い m=45MiB, t=2, p=1、salt は16バイト、出力は32バイト。
 *
 * 保存の形式は PHC 標準: `$argon2id$v=19$m=46080,t=2,p=1$<salt>$<hash>`（標準の base64、詰め物なし）。
 * 以前の形式 `argon2id$m=…,t=…,p=…$<salt>$<hash>`（base64url、Argon2 の版 0x13）も読み、サインインに成功したら新しい形式で保存し直す。
 */
export const passwordParameters = { memoryCost: 46_080, timeCost: 2, parallelism: 1, outputLen: 32, saltLength: 16 } as const;

// @node-rs/argon2 の enum は型だけで、実行時の値を持たない（const enum）。値は index.d.ts のとおり。
const ARGON2ID = 2 as Algorithm;
const VERSION_0x13 = 1 as Version;

interface StoredHash { format: 'phc' | 'legacy'; memoryCost: number; timeCost: number; parallelism: number; salt: Buffer; hash: Buffer }

const phc = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
const legacy = /^argon2id\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

/** 保存した値を読む。範囲の外のパラメータ（極端に重いものを含む）は読まない。 */
function parseStored(stored: string): StoredHash | null {
  const match = phc.exec(stored) ?? legacy.exec(stored);
  if (!match) return null;
  const encoding = stored.startsWith('$') ? 'base64' : 'base64url';
  const parsed: StoredHash = {
    format: stored.startsWith('$') ? 'phc' : 'legacy',
    memoryCost: Number(match[1]), timeCost: Number(match[2]), parallelism: Number(match[3]),
    salt: Buffer.from(match[4], encoding), hash: Buffer.from(match[5], encoding),
  };
  const sane = parsed.parallelism >= 1 && parsed.parallelism <= 16 && parsed.memoryCost >= 8 * parsed.parallelism && parsed.memoryCost <= 1_048_576
    && parsed.timeCost >= 1 && parsed.timeCost <= 10 && parsed.salt.length >= 8 && parsed.hash.length >= 16 && parsed.hash.length <= 64;
  return sane ? parsed : null;
}

const derive = (password: string, cost: Omit<StoredHash, 'format' | 'hash'>, outputLen: number) => hashRaw(password, {
  algorithm: ARGON2ID, version: VERSION_0x13, memoryCost: cost.memoryCost, timeCost: cost.timeCost, parallelism: cost.parallelism, outputLen, salt: cost.salt,
});

const unpadded = (value: Buffer) => value.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(passwordParameters.saltLength);
  const hash = await derive(password, { ...passwordParameters, salt }, passwordParameters.outputLen);
  return `$argon2id$v=19$m=${passwordParameters.memoryCost},t=${passwordParameters.timeCost},p=${passwordParameters.parallelism}$${unpadded(salt)}$${unpadded(hash)}`;
}

/** 登録のないメールアドレスや読めない値にも、同じパラメータで同じ計算をして、応答の時間で存在を知らせない。 */
const dummy: StoredHash = { format: 'phc', ...passwordParameters, salt: Buffer.alloc(passwordParameters.saltLength), hash: Buffer.alloc(passwordParameters.outputLen) };

export interface PasswordVerification {
  matched: boolean;
  /** 一致し、かつ以前の形式か今と違うパラメータで保存されている。新しい形式で保存し直す。 */
  needsRehash: boolean;
}

export async function checkPassword(password: string, stored: string | null | undefined): Promise<PasswordVerification> {
  const parsed = stored ? parseStored(stored) : null;
  const source = parsed ?? dummy;
  const key = await derive(password, source, source.hash.length);
  const matched = timingSafeEqual(key, source.hash) && parsed !== null;
  const current = parsed !== null && parsed.format === 'phc' && parsed.memoryCost === passwordParameters.memoryCost && parsed.timeCost === passwordParameters.timeCost
    && parsed.parallelism === passwordParameters.parallelism && parsed.salt.length === passwordParameters.saltLength && parsed.hash.length === passwordParameters.outputLen;
  return { matched, needsRehash: matched && !current };
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  return (await checkPassword(password, stored)).matched;
}

/**
 * サインインと本人確認で使う。一致して、以前の形式か今と違うパラメータなら、新しい形式で保存し直す。
 * 保存し直すのは、確かめた値がまだ保存されているときだけ（同時に変えたパスワードを上書きしない）。
 */
export async function verifyAndUpgradePassword(db: Db, userId: string | undefined, password: string, stored: string | null | undefined): Promise<boolean> {
  const result = await checkPassword(password, stored);
  if (result.needsRehash && userId && stored) db.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', await hashPassword(password), userId, stored);
  return result.matched;
}
