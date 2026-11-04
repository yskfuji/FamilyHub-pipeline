import { dateKeyFromRfc3339 } from './calendarDate';
import type { Memo } from './types';

/** メモの一覧の並び順。URL の sort の値と同じ。 */
export type MemoSort = 'newest' | 'oldest';

export const memoSorts: readonly MemoSort[] = ['newest', 'oldest'];

export const parseMemoSort = (value: string | null): MemoSort => (value === 'oldest' ? 'oldest' : 'newest');

/** メモの日付。指定がなければ最後に変更した日。 */
export const memoDateKey = (memo: Pick<Memo, 'memoDate' | 'updatedAt'>): string => memo.memoDate ?? dateKeyFromRfc3339(memo.updatedAt);

/** 日付で並べる。同じ日は変更した時刻の順にして、読み直しても動かない。 */
export function sortMemos(memos: readonly Memo[], sort: MemoSort): Memo[] {
  const direction = sort === 'newest' ? -1 : 1;
  return [...memos].sort((a, b) => (memoDateKey(a).localeCompare(memoDateKey(b)) || a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id)) * direction);
}
