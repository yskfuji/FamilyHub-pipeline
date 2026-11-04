import type { Album, AlbumItem, Id } from './types';

export const albumFilters = ['all', 'photos', 'videos'] as const;
export type AlbumFilter = (typeof albumFilters)[number];
export const parseAlbumFilter = (value: string | null): AlbumFilter => (value === 'photos' || value === 'videos' ? value : 'all');

/** 同じファイルが送られたときの文言。失敗ではないので、ほかの拒否と分けて扱う。 */
export const DUPLICATE_ITEM_MESSAGE = '同じ写真がすでにあります。';
export const isDuplicateItem = (item: Pick<AlbumItem, 'status' | 'statusMessage'>) => item.status === 'rejected' && item.statusMessage === DUPLICATE_ITEM_MESSAGE;

/** 保存できなかったファイル。同じファイルだったものは含めない。 */
export const rejectedItems = (items: readonly AlbumItem[]) => items.filter((item) => item.status === 'rejected' && !isDuplicateItem(item));
export const readyItems = (items: readonly AlbumItem[]) => items.filter((item) => item.status === 'ready');
export const hasProcessing = (items: readonly AlbumItem[]) => items.some((item) => item.status === 'processing');

const matches = (item: AlbumItem, filter: AlbumFilter) => filter === 'all' || (filter === 'videos') === (item.kind === 'video');

/** 一覧に並べる項目。送っている途中の分は送った人の待ち行列に出るので、ここには並べない。 */
export const gridItems = (items: readonly AlbumItem[], filter: AlbumFilter) => items.filter((item) => (item.status === 'ready' || item.status === 'processing') && matches(item, filter));

export function filterCounts(items: readonly AlbumItem[]): Record<AlbumFilter, number> {
  return { all: gridItems(items, 'all').length, photos: gridItems(items, 'photos').length, videos: gridItems(items, 'videos').length };
}

/**
 * 表示している項目の中で1つ前か後へ動かした、全体の並び。
 * 絞り込み中でも、隣に見えている項目と入れ替える。規則は全項目の並びを求めるので、全体を返す。
 */
export function moveItem(order: readonly Id[], visible: readonly Id[], id: Id, step: -1 | 1): Id[] {
  const neighbor = visible[visible.indexOf(id) + step];
  if (!visible.includes(id) || neighbor === undefined) return [...order];
  return order.map((entry) => (entry === id ? neighbor : entry === neighbor ? id : entry));
}

/** 表紙にする項目。指定が消えていたら、縮小画像のある最初の項目にする。 */
export function coverItem(album: Pick<Album, 'coverItemId'>, items: readonly AlbumItem[]) {
  const usable = readyItems(items).filter((item) => item.hasThumbnail);
  return usable.find((item) => item.id === album.coverItemId) ?? usable[0];
}

/** 前後への移動。端まで行ったら反対の端へ戻る。 */
export const stepIndex = (index: number, length: number, step: number) => (length ? (index + step + length) % length : 0);

export const SWIPE_DISTANCE = 48;
/** 横の払いの向き。前へ戻るなら -1、次へ進むなら 1、縦の動きや短い動きなら 0。 */
export function swipeStep(deltaX: number, deltaY: number): -1 | 0 | 1 {
  if (Math.abs(deltaX) < SWIPE_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY)) return 0;
  return deltaX < 0 ? 1 : -1;
}

/** 動画を外すと何も残らないアルバムでは、動画のまま流す。 */
export function slideshowItems(items: readonly AlbumItem[], includeVideos: boolean) {
  const ready = readyItems(items);
  const photos = ready.filter((item) => item.kind === 'photo');
  if (includeVideos) return { items: ready, keptVideos: false };
  return photos.length ? { items: photos, keptVideos: false } : { items: ready, keptVideos: ready.length > 0 };
}

/** 項目を消したあとに開く項目。次がなければ前を開く。 */
export function neighborAfterRemoval(items: readonly AlbumItem[], id: Id) {
  const index = items.findIndex((item) => item.id === id);
  return items[index + 1] ?? items[index - 1];
}

/** 一覧の並べ方（A15-5）。album はアルバムに並べた順、taken は撮影日時の古い順。 */
export const albumSorts = ['album', 'taken'] as const;
export type AlbumSort = (typeof albumSorts)[number];
export const parseAlbumSort = (value: string | null): AlbumSort => (value === 'taken' ? 'taken' : 'album');

/**
 * 並べ方に合わせた項目の並び。撮影日順では、撮影日時の古い順にし、撮影日時の分からない項目は最後に置く。
 * 同じ日時の項目と、撮影日時の分からない項目どうしは、アルバムに並べた順を保つ。
 */
export function sortItems<T extends Pick<AlbumItem, 'takenAt'>>(items: readonly T[], sort: AlbumSort): T[] {
  if (sort === 'album') return [...items];
  const time = (item: T) => (item.takenAt ? Date.parse(item.takenAt) : Number.NaN);
  return items.map((item, index) => ({ item, index, at: time(item) })).sort((a, b) => {
    const aKnown = Number.isFinite(a.at); const bKnown = Number.isFinite(b.at);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    return (aKnown && a.at !== b.at ? a.at - b.at : 0) || a.index - b.index;
  }).map(({ item }) => item);
}
