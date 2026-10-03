import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../data/fixtures';
import { aggregatePlaces, placeKey, sortPlaces } from './places';

describe('places aggregation', () => {
  it('groups places by normalized name and address across expenses and memos', () => {
    const extra = { ...baseSnapshot.expenses[1], place: { name: '青葉書店', address: '東京都世田谷区', capturedVia: 'manual' as const, selectedAt: '2026-09-27T10:00:00+09:00' } };
    const items = aggregatePlaces([...baseSnapshot.expenses.filter((expense) => expense.id !== extra.id), extra], baseSnapshot.memos);
    const books = items.find((item) => item.key === placeKey('青葉書店', '東京都世田谷区'));
    expect(books).toMatchObject({ expenseCount: 2, memoCount: 0, expenseTotalJpy: 2860 + 3360, lastUsedOn: '2026-09-29' });
    expect(items.find((item) => item.place.name === '青葉小学校 体育館')).toMatchObject({ memoCount: 1 });
  });

  it('sorts by recent use by default and by amount or frequency on request', () => {
    const items = aggregatePlaces(baseSnapshot.expenses, baseSnapshot.memos);
    expect(sortPlaces(items, 'recent')[0].lastUsedOn >= sortPlaces(items, 'recent')[1].lastUsedOn).toBe(true);
    expect(sortPlaces(items, 'amount')[0].place.name).toBe('青葉書店');
    expect(placeKey('Ａ店 ')).toBe(placeKey('a店'));
  });

  it('ignores deleted records', () => {
    const deleted = baseSnapshot.expenses.map((expense) => ({ ...expense, deletedAt: '2026-09-30T08:00:00+09:00' }));
    expect(aggregatePlaces(deleted, []).length).toBe(0);
  });
});
