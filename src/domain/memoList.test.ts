import { describe, expect, it } from 'vitest';
import { memoDateKey, parseMemoSort, sortMemos } from './memoList';
import type { IsoDate, Memo } from './types';

const memo = (id: string, updatedAt: string, memoDate?: IsoDate) => ({ id, updatedAt, memoDate }) as Memo;
const memos = [memo('a', '2026-09-29T21:10:00+09:00'), memo('b', '2026-09-28T18:40:00+09:00', '2026-10-05'), memo('c', '2026-09-30T06:50:00+09:00'), memo('d', '2026-09-29T07:00:00+09:00')];

describe('memo list', () => {
  it('uses the memo date, or the JST day of the last change', () => {
    expect(memoDateKey(memos[1])).toBe('2026-10-05');
    expect(memoDateKey(memo('x', '2026-09-30T16:00:00Z'))).toBe('2026-10-01');
  });

  it('sorts both ways and keeps a fixed order within a day', () => {
    expect(sortMemos(memos, 'newest').map((item) => item.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sortMemos(memos, 'oldest').map((item) => item.id)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('treats an unknown sort as newest', () => {
    expect(parseMemoSort('oldest')).toBe('oldest');
    expect(parseMemoSort('title')).toBe('newest');
    expect(parseMemoSort(null)).toBe('newest');
  });
});
