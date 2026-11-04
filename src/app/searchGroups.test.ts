import { describe, expect, it } from 'vitest';
import type { SearchResult } from '../data/gateway';
import { groupSearchResults } from './searchGroups';

describe('grouped search results (A17-5)', () => {
  it('puts results under one heading per kind, in a fixed order, keeping the order inside each group', () => {
    const result = (kind: SearchResult['kind'], id: string): SearchResult => ({ kind, id, label: id, destination: `/${id}` });
    const groups = groupSearchResults([result('albumItem', 'p1'), result('event', 'e1'), result('album', 'a1'), result('albumItem', 'p2'), result('memo', 'm1'), result('event', 'e2')]);
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([['予定', ['e1', 'e2']], ['メモ', ['m1']], ['アルバム', ['a1']], ['写真・動画', ['p1', 'p2']]]);
    expect(groupSearchResults([])).toEqual([]);
  });
});
