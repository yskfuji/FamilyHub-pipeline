import { serverMessages } from '../../src/content/serverMessages';
import { ApiError } from './context';
import type { AppDeps } from './context';

/** 回数の上限。推測を防ぐ操作に使う。同じ窓の中で max を超えたら止める。 */
export function limit(deps: AppDeps, bucket: string, max: number, windowMs: number) {
  const now = Date.parse(deps.clock.now());
  deps.db.transaction(() => {
    const row = deps.db.get<{ count: number; window_started_at: number }>('SELECT count, window_started_at FROM rate_limits WHERE bucket = ?', bucket);
    if (!row || now - row.window_started_at >= windowMs) {
      deps.db.run('INSERT INTO rate_limits (bucket, count, window_started_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = 1, window_started_at = excluded.window_started_at', bucket, now);
      return;
    }
    if (row.count >= max) throw new ApiError(429, { code: 'RATE_LIMITED', message: serverMessages.rateLimited, retryable: true });
    deps.db.run('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?', bucket);
  });
}

/**
 * 送り元のアドレスごとの上限に使う値。IPv6 は /64 にまとめる。1つの回線には /64 がまるごと配られるので、
 * 末尾を替えるだけで上限を逃れられないようにする（侵入試験 PT-RATE、docs/security/pentest-2026-11.md）。
 * IPv4 を IPv6 の形で書いたもの（::ffff:192.0.2.1）は IPv4 として扱う。
 */
export function addressBucket(address: string): string {
  const ip = address.split('%')[0];
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const groups = tail === undefined ? front : [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group || '0', 16).toString(16)).join(':')}::/64`;
}

/** 窓を過ぎた上限の記録を消す。新しいアドレスやメールアドレスごとに行が増え続けないようにする。 */
export function purgeRateLimits(deps: Pick<AppDeps, 'db' | 'clock'>, olderThanMs = 2 * 86_400_000) {
  deps.db.run('DELETE FROM rate_limits WHERE window_started_at < ?', Date.parse(deps.clock.now()) - olderThanMs);
}

/** 数えずに、上限に達しているかだけを確かめる。失敗した試しだけを数える操作で、確かめる前に使う。 */
export function checkLimit(deps: Pick<AppDeps, 'db' | 'clock'>, bucket: string, max: number, windowMs: number) {
  const row = deps.db.get<{ count: number; window_started_at: number }>('SELECT count, window_started_at FROM rate_limits WHERE bucket = ?', bucket);
  if (row && Date.parse(deps.clock.now()) - row.window_started_at < windowMs && row.count >= max) throw new ApiError(429, { code: 'RATE_LIMITED', message: serverMessages.rateLimited, retryable: true });
}
