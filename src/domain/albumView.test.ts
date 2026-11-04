import { describe, expect, it } from 'vitest';
import { DUPLICATE_ITEM_MESSAGE, coverItem, filterCounts, gridItems, hasProcessing, isDuplicateItem, moveItem, neighborAfterRemoval, parseAlbumFilter, rejectedItems, slideshowItems, stepIndex, swipeStep } from './albumView';
import type { AlbumItem } from './types';

const item = (id: string, changes: Partial<AlbumItem> = {}): AlbumItem => ({ id, albumId: 'a', householdId: 'h', kind: 'photo', originalName: `${id}.jpg`, mimeType: 'image/jpeg', byteSize: 10, status: 'ready', locationKept: false, hasThumbnail: true, uploaderMembershipId: 'm', position: 0, createdAt: '2026-10-01T00:00:00+09:00', ...changes });
const ids = (items: readonly AlbumItem[]) => items.map((entry) => entry.id);

describe('album items', () => {
  const items = [item('p'), item('v', { kind: 'video' }), item('work', { status: 'processing' }), item('sending', { status: 'uploading' }), item('bad', { status: 'rejected', statusMessage: 'この形式のファイルは受け付けていません。' }), item('same', { status: 'rejected', statusMessage: DUPLICATE_ITEM_MESSAGE })];

  it('filters what the grid shows and leaves uploads and refusals out', () => {
    expect(ids(gridItems(items, 'all'))).toEqual(['p', 'v', 'work']);
    expect(ids(gridItems(items, 'videos'))).toEqual(['v']);
    expect(ids(gridItems(items, 'photos'))).toEqual(['p', 'work']);
    expect(filterCounts(items)).toEqual({ all: 3, photos: 2, videos: 1 });
  });

  it('reads the filter from the URL and falls back to all', () => {
    expect(parseAlbumFilter('videos')).toBe('videos');
    expect(parseAlbumFilter('nonsense')).toBe('all');
    expect(parseAlbumFilter(null)).toBe('all');
  });

  it('tells a duplicate from a refusal', () => {
    expect(isDuplicateItem(items[5])).toBe(true);
    expect(isDuplicateItem(items[4])).toBe(false);
    expect(ids(rejectedItems(items))).toEqual(['bad']);
    expect(hasProcessing(items)).toBe(true);
    expect(hasProcessing([items[0]])).toBe(false);
  });
});

describe('moveItem', () => {
  it('swaps with the neighbor', () => {
    expect(moveItem(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });
  it('swaps with the visible neighbor while filtered and keeps hidden items in place', () => {
    expect(moveItem(['a', 'x', 'b', 'c'], ['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'x', 'a', 'c']);
  });
  it('does nothing at the ends or for an unknown item', () => {
    expect(moveItem(['a', 'b'], ['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], ['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], ['a'], 'b', -1)).toEqual(['a', 'b']);
  });
});

describe('coverItem', () => {
  const items = [item('video', { kind: 'video', hasThumbnail: false }), item('a'), item('b')];
  it('uses the chosen item', () => { expect(coverItem({ coverItemId: 'b' }, items)?.id).toBe('b'); });
  it('falls back to the first item with a thumbnail when the choice is gone', () => { expect(coverItem({ coverItemId: 'gone' }, items)?.id).toBe('a'); });
  it('is empty when nothing can be shown', () => { expect(coverItem({}, [item('x', { status: 'processing' })])).toBeUndefined(); });
});

describe('stepping and swiping', () => {
  it('wraps around', () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
  it('reads a horizontal swipe', () => {
    expect(swipeStep(-80, 10)).toBe(1);
    expect(swipeStep(80, 10)).toBe(-1);
  });
  it('ignores short and vertical movement', () => {
    expect(swipeStep(-20, 0)).toBe(0);
    expect(swipeStep(-60, 90)).toBe(0);
  });
  it('picks the next item after a removal, or the previous one at the end', () => {
    const items = [item('a'), item('b'), item('c')];
    expect(neighborAfterRemoval(items, 'b')?.id).toBe('c');
    expect(neighborAfterRemoval(items, 'c')?.id).toBe('b');
    expect(neighborAfterRemoval([item('a')], 'a')).toBeUndefined();
  });
});

describe('slideshowItems', () => {
  const items = [item('p'), item('v', { kind: 'video' }), item('work', { status: 'processing' })];
  it('includes only ready items', () => { expect(ids(slideshowItems(items, true).items)).toEqual(['p', 'v']); });
  it('leaves videos out on request', () => { expect(slideshowItems(items, false)).toMatchObject({ keptVideos: false, items: [{ id: 'p' }] }); });
  it('keeps videos when nothing else would remain, and says so', () => {
    expect(slideshowItems([item('v', { kind: 'video' })], false)).toMatchObject({ keptVideos: true, items: [{ id: 'v' }] });
  });
});

describe('sorting by capture time (A15-5)', () => {
  const at = (id: string, takenAt?: string) => ({ id, takenAt });
  it('keeps the album order, or puts the oldest first and items without a capture time last', async () => {
    const { parseAlbumSort, sortItems } = await import('./albumView');
    const items = [at('none-1'), at('late', '2026-09-20T11:40:12+09:00'), at('early', '2026-09-20T09:12:30+09:00'), at('none-2'), at('same-a', '2026-09-20T10:00:00+09:00'), at('same-b', '2026-09-20T01:00:00Z')];
    expect(sortItems(items, 'album').map((item) => item.id)).toEqual(['none-1', 'late', 'early', 'none-2', 'same-a', 'same-b']);
    // 時差の違う書き方でも、同じ時刻なら並べた順を保つ（10:00+09:00 と 01:00Z は同じ時刻）。
    expect(sortItems(items, 'taken').map((item) => item.id)).toEqual(['early', 'same-a', 'same-b', 'late', 'none-1', 'none-2']);
    expect(sortItems([at('x', 'not a date'), at('y', '2026-01-01T00:00:00Z')], 'taken').map((item) => item.id)).toEqual(['y', 'x']);
    expect(parseAlbumSort('taken')).toBe('taken');
    expect(parseAlbumSort('other')).toBe('album');
    expect(parseAlbumSort(null)).toBe('album');
  });
});
