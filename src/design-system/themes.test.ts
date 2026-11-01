import { describe, expect, it } from 'vitest';
import { allThemes, isNightTheme } from '../domain/theme';
import themesCss from './themes.css?raw';
import tokensCss from './tokens.css?raw';

/** セレクタの中の --名前: 値 を読む。 */
function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const root = declarations(tokensCss, ':root');
const dusk = declarations(tokensCss, "[data-theme='dusk']");
/** テーマごとに変わる値（色と影）。文字の大きさや余白などは共通。 */
const themedTokens = Object.keys(dusk);

function tokensOf(theme: string): Record<string, string> {
  if (theme === 'light') return root;
  if (theme === 'dusk') return { ...root, ...dusk };
  return { ...root, ...declarations(themesCss, `[data-theme='${theme}']`) };
}

const channel = (hex: string, start: number) => parseInt(hex.slice(start, start + 2), 16);
const rgb = (hex: string): [number, number, number] => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
const luminance = (color: readonly number[]) => {
  const [r, g, b] = color.map((value) => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (foreground: readonly number[], background: readonly number[]) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};
/** color-mix(in srgb, a W%, b)。 */
const mix = (a: readonly number[], weight: number, b: readonly number[]) => a.map((value, index) => value * weight + b[index] * (1 - weight));

/** 画面で文字として使う組み合わせ。[説明, 文字, 面]。 */
const textPairs: ReadonlyArray<readonly [string, string, string]> = [
  ['本文（紙）', '--ink', '--paper'], ['本文（濃い紙）', '--ink', '--paper-deep'], ['本文（面）', '--ink', '--sheet'], ['本文（高い面）', '--ink', '--sheet-raised'],
  ['補足（紙）', '--ink-soft', '--paper'], ['補足（濃い紙）', '--ink-soft', '--paper-deep'], ['補足（面）', '--ink-soft', '--sheet'], ['補足（高い面）', '--ink-soft', '--sheet-raised'],
  ['淡い文字（面）', '--ink-faint', '--sheet'], ['淡い文字（紙）', '--ink-faint', '--paper'],
  ['リンク（面）', '--indigo', '--sheet'], ['リンク（紙）', '--indigo', '--paper'],
  ['見出しの小さな文字（紙）', '--persimmon', '--paper'], ['見出しの小さな文字（面）', '--persimmon', '--sheet'],
  ['時刻', '--indigo-strong', '--sheet'],
  ['誤りの文字', '--danger', '--danger-soft'], ['誤りの文字（面）', '--danger', '--sheet'],
  ['成功の文字', '--success', '--success-soft'], ['成功の文字（面）', '--success', '--sheet'],
  ['空の状態の印', '--moss', '--moss-soft'],
  ['頭文字', '--paper-deep', '--indigo'],
];

describe('配色の濃さ', () => {
  for (const theme of allThemes) {
    describe(theme, () => {
      const tokens = tokensOf(theme);
      const color = (name: string) => rgb(tokens[name]);

      it('テーマごとの値をすべて定義している', () => {
        expect(themedTokens.length).toBeGreaterThan(20);
        expect(themedTokens.filter((name) => !tokens[name])).toEqual([]);
      });

      it('色は6桁の16進数で書いている', () => {
        const colors = themedTokens.filter((name) => !name.startsWith('--shadow')).map((name) => tokens[name]);
        expect(colors.filter((value) => !/^#[0-9a-f]{6}$/.test(value))).toEqual([]);
      });

      for (const [label, text, surface] of textPairs) {
        // 既定の light の --ink-faint は 4.5:1 に届かない。既定の見た目を変えない決まりなので、下げ止まりだけを確かめる。
        const minimum = theme === 'light' && text === '--ink-faint' ? 3.75 : 4.5;
        it(`${label}は ${minimum}:1 以上`, () => { expect(contrast(color(text), color(surface))).toBeGreaterThanOrEqual(minimum); });
      }

      it('主なボタンの文字は 4.5:1 以上', () => {
        const label = theme === 'light' ? '#ffffff' : theme === 'dusk' ? '#102433' : tokens['--on-accent'];
        expect(contrast(rgb(label), color('--indigo-strong'))).toBeGreaterThanOrEqual(4.5);
      });

      it('要確認の札の文字は 4.5:1 以上', () => {
        expect(contrast(mix(color('--persimmon'), 0.75, color('--ink')), color('--persimmon-soft'))).toBeGreaterThanOrEqual(4.5);
      });

      it('フォーカスの印は面と 3:1 以上の差がある', () => {
        expect(contrast(color('--focus'), color('--sheet'))).toBeGreaterThanOrEqual(3);
        expect(contrast(color('--focus'), color('--paper'))).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('夜のテーマは暗い紙の上に明るい文字をのせる', () => {
    for (const theme of allThemes) {
      const tokens = tokensOf(theme);
      expect(luminance(rgb(tokens['--paper'])) < luminance(rgb(tokens['--ink']))).toBe(isNightTheme(theme));
    }
  });

  it('既定の light と dusk の値は変わっていない', () => {
    expect(root['--paper']).toBe('#f6f0e5');
    expect(root['--ink']).toBe('#202b33');
    expect(root['--indigo-strong']).toBe('#173951');
    expect(dusk['--paper']).toBe('#101e2b');
    expect(dusk['--ink']).toBe('#f7f1e8');
    expect(themesCss).not.toContain("[data-theme='dusk']");
    expect(themesCss).not.toContain("[data-theme='light']");
  });
});
