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
