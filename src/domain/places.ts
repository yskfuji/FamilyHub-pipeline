import type { Expense, Id, Memo, PlaceRef } from './types';

const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/** 名前と住所から作る安定したキー（FNV-1a 32bit）。外部データに ID がないため、表示・URL・操作 ID に使う。 */
export function placeKey(name: string, address = ''): string {
  let hash = 0x811c9dc5;
  for (const char of `${normalize(name)}|${normalize(address)}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export const keyOfPlace = (place: PlaceRef) => placeKey(place.name, place.address ?? '');

export interface PlaceUse { kind: 'expense' | 'memo'; id: Id; title: string; date: string; amountJpy?: number }
export interface PlaceSummaryItem {
  key: string;
  /** 最後に記録した内容（名前・住所・出典など）。 */
  place: PlaceRef;
  uses: PlaceUse[];
  expenseCount: number;
  memoCount: number;
  expenseTotalJpy: number;
  lastUsedOn: string;
}
export type PlaceSort = 'recent' | 'amount' | 'frequency';

/**
 * 支出とメモに記録した場所を、同じ名前・住所ごとにまとめる。入力は閲覧者に見えている記録だけとし、
 * 場所を読めない閲覧者には、射影の段階で場所が除かれているため何も返らない。
 */
export function aggregatePlaces(expenses: Expense[], memos: Memo[]): PlaceSummaryItem[] {
  const groups = new Map<string, PlaceSummaryItem>();
  const add = (place: PlaceRef, use: PlaceUse) => {
    const key = keyOfPlace(place);
    const group = groups.get(key) ?? { key, place, uses: [], expenseCount: 0, memoCount: 0, expenseTotalJpy: 0, lastUsedOn: use.date };
    group.uses.push(use);
    if (use.kind === 'expense') { group.expenseCount += 1; group.expenseTotalJpy += use.amountJpy ?? 0; } else group.memoCount += 1;
    if (use.date >= group.lastUsedOn) { group.lastUsedOn = use.date; group.place = place; }
    groups.set(key, group);
  };
  for (const expense of expenses) if (expense.place && !expense.deletedAt) add(expense.place, { kind: 'expense', id: expense.id, title: expense.title, date: expense.incurredOn, amountJpy: expense.amountJpy });
  for (const memo of memos) if (memo.place && !memo.deletedAt) add(memo.place, { kind: 'memo', id: memo.id, title: memo.title, date: memo.updatedAt.slice(0, 10) });
  for (const group of groups.values()) group.uses.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'ja'));
  return [...groups.values()];
}

/** 並べ替え。既定は「最近」。回数順は生活圏の推測につながりやすいため、利用者が選んだときだけ使う。 */
export function sortPlaces(items: PlaceSummaryItem[], sort: PlaceSort): PlaceSummaryItem[] {
  const byName = (a: PlaceSummaryItem, b: PlaceSummaryItem) => a.place.name.localeCompare(b.place.name, 'ja');
  const compare = sort === 'amount' ? (a: PlaceSummaryItem, b: PlaceSummaryItem) => b.expenseTotalJpy - a.expenseTotalJpy || b.lastUsedOn.localeCompare(a.lastUsedOn) || byName(a, b)
    : sort === 'frequency' ? (a: PlaceSummaryItem, b: PlaceSummaryItem) => b.uses.length - a.uses.length || b.lastUsedOn.localeCompare(a.lastUsedOn) || byName(a, b)
      : (a: PlaceSummaryItem, b: PlaceSummaryItem) => b.lastUsedOn.localeCompare(a.lastUsedOn) || byName(a, b);
  return [...items].sort(compare);
}
