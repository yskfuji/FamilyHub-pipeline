import { describe, expect, it } from 'vitest';
import { allThemes, isNightTheme, paletteOf, parseTheme, themeFor } from './theme';

describe('配色', () => {
  it('標準の組は今までの light と dusk のまま', () => {
    expect(themeFor('standard', false)).toBe('light');
    expect(themeFor('standard', true)).toBe('dusk');
  });
  it('5つの組に昼と夜がある', () => {
    expect(allThemes).toHaveLength(10);
    expect(new Set(allThemes).size).toBe(10);
    expect(themeFor('matcha', false)).toBe('matcha');
    expect(themeFor('matcha', true)).toBe('matcha-night');
  });
  it('保存した値から組と昼夜を読み戻せる', () => {
    expect(allThemes.map((theme) => themeFor(paletteOf(theme), isNightTheme(theme)))).toEqual(allThemes);
  });
  it('知らない値は既定の light にする', () => {
    expect(parseTheme('forest')).toBe('light');
    expect(parseTheme(null)).toBe('light');
    expect(parseTheme('dusk')).toBe('dusk');
  });
});
