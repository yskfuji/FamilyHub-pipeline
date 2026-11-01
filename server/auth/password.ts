import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/** パスワードのハッシュ。Node の argon2 の変更はこのファイルで受ける。 */
const parameters = { memory: 46_080, passes: 2, parallelism: 1, tagLength: 32 };

const derive = (password: string, nonce: Buffer, cost: typeof parameters) => new Promise<Buffer>((resolve, reject) => {
  argon2('argon2id', { message: password, nonce, ...cost }, (error, key) => error ? reject(error) : resolve(key));
});

export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const key = await derive(password, nonce, parameters);
  return `argon2id$m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism}$${nonce.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  // 登録のないメールアドレスでも同じ計算をして、応答の時間で存在を知らせない。
  const source = stored ?? `argon2id$m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const match = /^argon2id\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(source);
  if (!match) return false;
  const expected = Buffer.from(match[5], 'base64url');
  const key = await derive(password, Buffer.from(match[4], 'base64url'), { memory: Number(match[1]), passes: Number(match[2]), parallelism: Number(match[3]), tagLength: expected.length });
  return timingSafeEqual(key, expected) && Boolean(stored);
}
