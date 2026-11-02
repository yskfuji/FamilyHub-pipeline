import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
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

const keyFor = (masterSecret: string) => Buffer.from(hkdfSync('sha256', masterSecret, 'family-hub', 'totp-secret', 32));

/** TOTP の秘密は検証に元の値が要るので、ハッシュではなく暗号化して保存する。 */
export function encryptSecret(masterSecret: string, secret: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(masterSecret), iv);
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(masterSecret: string, stored: string) {
  const [iv, tag, body] = stored.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', keyFor(masterSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export const hashRecoveryCode = (code: string) => createHash('sha256').update(`recovery:${code.replaceAll('-', '').toUpperCase()}`).digest('base64url');

export function newRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => { const raw = randomBytes(5).toString('hex').toUpperCase(); return `${raw.slice(0, 5)}-${raw.slice(5)}`; });
}

export const totpUri = (email: string, secret: Buffer) => `otpauth://totp/${encodeURIComponent(`${serverMessages.brand}:${email}`)}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(serverMessages.brand)}&period=${STEP_SECONDS}&digits=6`;
