import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Keyring } from './keyring';
import { serverMessages } from '../../src/content/serverMessages';

/** RFC 6238 の確認コード（SHA-1、30秒、6桁）。 */
const STEP_SECONDS = 30;
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(value: Buffer) {
  let bits = 0; let buffer = 0; let output = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { output += base32Alphabet[(buffer >>> (bits - 5)) & 31]; bits -= 5; }
    buffer &= (1 << bits) - 1;
  }
  return bits ? output + base32Alphabet[(buffer << (5 - bits)) & 31] : output;
}

export function hotp(secret: Buffer, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** 一致した時間枠を返す。前後1枠まで許し、一度使った枠より前は受け付けない（再利用を防ぐ）。 */
export function matchingStep(secret: Buffer, code: string, nowMs: number, lastStep: number | null) {
  const current = stepAt(nowMs);
  for (const step of [current - 1, current, current + 1]) {
    if ((lastStep === null || step > lastStep) && hotp(secret, step) === code) return step;
  }
  return null;
}

/** TOTP の秘密は検証に元の値が要るので、ハッシュではなく暗号化して保存する（RFC 6238 5.1）。鍵束の有効な鍵で封をする。 */
export const sealTotpSecret = (keys: Keyring, userId: string, secret: Buffer) => keys.seal('totp-secret', userId, secret);

/** 読めなければ null。鍵がない・引退した・秘密が違うときも、例外にせず「使えない」として扱う。 */
export const openTotpSecret = (keys: Keyring, userId: string, stored: string) => keys.open('totp-secret', userId, stored);

export const hashRecoveryCode = (code: string) => createHash('sha256').update(`recovery:${code.replaceAll('-', '').toUpperCase()}`).digest('base64url');

export function newRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => { const raw = randomBytes(5).toString('hex').toUpperCase(); return `${raw.slice(0, 5)}-${raw.slice(5)}`; });
}

export const totpUri = (email: string, secret: Buffer) => `otpauth://totp/${encodeURIComponent(`${serverMessages.brand}:${email}`)}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(serverMessages.brand)}&period=${STEP_SECONDS}&digits=6`;
