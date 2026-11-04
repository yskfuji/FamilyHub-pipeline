import type { Rfc3339 } from './types';

/** 削除から元に戻せる日数。 */
export const RESTORE_WINDOW_DAYS = 7;
/** 削除から記録を完全に消すまでの日数。 */
export const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

/** 元に戻せる残りの日数。途中の日も1日と数える。読み込んだ時刻が削除より前でも、期間より長くは出さない。 */
export function restoreDaysLeft(deletedAt: Rfc3339, now: Rfc3339): number {
  const left = Date.parse(deletedAt) + RESTORE_WINDOW_DAYS * DAY_MS - Date.parse(now);
  return Math.min(RESTORE_WINDOW_DAYS, Math.max(1, Math.ceil(left / DAY_MS)));
}
