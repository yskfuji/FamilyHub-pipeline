import { describe, expect, it } from 'vitest';
import { settingsRoutes } from './settingsRoutes';
import { filterHelpItems, helpCategories, helpItems, parseHelpCategory } from './help';

describe('ヘルプ', () => {
  it('4つの分類に約20問あり、どの分類にも質問がある', () => {
    expect(helpCategories).toHaveLength(4);
    expect(helpItems.length).toBeGreaterThanOrEqual(20);
    for (const { id } of helpCategories) expect(helpItems.some((item) => item.category === id)).toBe(true);
  });
  it('深いリンクの ID は重ならない', () => {
    expect(new Set(helpItems.map((item) => item.id)).size).toBe(helpItems.length);
  });
  it('案内先は設定の実在するタブ', () => {
    for (const item of helpItems) if (item.related) expect(settingsRoutes).toContain(item.related.href);
  });
  it('語は全角と半角、大文字と小文字を区別しない', () => {
    expect(filterHelpItems(helpItems, 'ｈｅｉｃ', null).map((item) => item.id)).toContain('album-formats');
    expect(filterHelpItems(helpItems, 'openpoi', null).map((item) => item.id)).toContain('place-lookup');
  });
  it('分類と語を一緒に絞れる', () => {
    expect(filterHelpItems(helpItems, '写真', 'records').every((item) => item.category === 'records')).toBe(true);
    expect(filterHelpItems(helpItems, '写真', 'family')).toEqual([]);
  });
  it('一致しない語は0件で、空の語なら全件', () => {
    expect(filterHelpItems(helpItems, '存在しない語句', null)).toEqual([]);
    expect(filterHelpItems(helpItems, '  ', null)).toHaveLength(helpItems.length);
  });
  it('知らない分類は「すべて」として扱う', () => {
    expect(parseHelpCategory('family')).toBe('family');
    expect(parseHelpCategory('x')).toBeNull();
  });
});
