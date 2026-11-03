import { describe, expect, it } from 'vitest';
import { allThemes, isNightTheme } from '../domain/theme';
import type { Theme } from '../domain/types';
import themesCss from './themes.css?raw';
import tokensCss from './tokens.css?raw';
import globalCss from './global.css?raw';
import managementCss from '../features/showcase/management/management.css?raw';

/**
 * 宣言した文字色と面の組が、全10テーマで WCAG 2.2 の比を満たすこと（A11-2）と、部品の境界・印が 3:1 以上であること（A11-4）。
 * 比は丸めない（4.499 は 4.5 に届かない）。例外は置かない。実際の画面の濃さは e2e/contrast.spec.ts（A11-3）。
 */

type Block = { selectors: string[]; values: Record<string, string> };

/** @layer tokens の中の規則を、書いた順に読む。 */
function blocks(css: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, prelude, body]) => ({
      selectors: prelude.split(',').map((part) => part.trim()).filter(Boolean),
      values: Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
    }))
    .filter((block) => !block.selectors.some((selector) => selector.startsWith('@')));
}

const rules = [...blocks(tokensCss), ...blocks(themesCss)];
const applies = (selector: string, theme: Theme) => selector === ':root'
  || selector === `[data-theme='${theme}']`
  || (selector === "[data-theme$='-night']" && theme.endsWith('-night'));

/** そのテーマで効く値。:root と属性のセレクタは同じ詳細度なので、後に書いたものが勝つ。 */
function tokensOf(theme: Theme): Record<string, string> {
  return Object.assign({}, ...rules.filter((rule) => rule.selectors.some((selector) => applies(selector, theme))).map((rule) => rule.values));
}

/** テーマごとに持つ色の役割。 */
const colorRoles = [
  '--paper', '--paper-deep', '--sheet', '--sheet-raised', '--ink', '--ink-soft', '--ink-faint', '--line', '--line-strong',
  '--accent', '--accent-strong', '--on-accent', '--brand', '--brand-soft', '--on-brand', '--attention', '--attention-soft',
  '--info', '--info-soft', '--danger', '--danger-soft', '--success', '--success-soft', '--moss', '--moss-soft', '--gold', '--focus',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6',
] as const;
const surfaces = ['--paper', '--paper-deep', '--sheet', '--sheet-raised'] as const;

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

/** 面。トークンか、global.css の color-mix と同じ混ぜ方。 */
type Surface = string | readonly [string, number, string];
const surfaceLabel = (surface: Surface) => typeof surface === 'string' ? surface : `${surface[0]} ${surface[1] * 100}% と ${surface[2]}`;

/** 文字として使う組。[説明, 文字, 面の一覧]。面は、その文字が実際にのる面をすべて並べる。 */
const textPairs: ReadonlyArray<readonly [string, string, readonly Surface[]]> = [
  ['本文', '--ink', [...surfaces, '--brand-soft', '--moss-soft', '--info-soft', '--success-soft', ['--brand-soft', 0.48, '--sheet'], ['--accent', 0.12, '--sheet'], ['--paper', 0.7, '--sheet']]],
  ['補足', '--ink-soft', [...surfaces, '--moss-soft', '--info-soft', ['--brand-soft', 0.48, '--sheet'], ['--accent', 0.12, '--sheet'], ['--paper', 0.7, '--sheet'], ['--paper-deep', 0.55, '--paper']]],
  ['淡い文字', '--ink-faint', [...surfaces, ['--paper-deep', 0.55, '--paper'], ['--paper', 0.7, '--sheet']]],
  ['リンク・土曜', '--accent', [...surfaces, '--info-soft', ['--accent', 0.12, '--sheet']]],
  ['時刻・選んだ項目', '--accent-strong', surfaces],
  ['主なボタンの文字', '--on-accent', ['--accent-strong']],
  ['見出しの小さな文字', '--brand', surfaces],
  ['件数の印の文字', '--on-brand', ['--brand']],
  ['要確認の札', '--attention', ['--attention-soft', '--sheet', ['--brand-soft', 0.48, '--sheet']]],
  ['案内', '--info', ['--info-soft', '--sheet']],
  ['誤り・祝日', '--danger', [...surfaces, '--danger-soft']],
  ['成功', '--success', [...surfaces, '--success-soft']],
  ['場所', '--moss', [...surfaces, '--moss-soft', ['--moss-soft', 0.7, '--sheet'], ['--moss-soft', 0.55, '--sheet']]],
  ['予定の表の金額', '--gold', [...surfaces, ['--paper', 0.7, '--sheet']]],
];

/** 部品を見分けるのに必要な境界と印（1.4.11）。[説明, 色, 隣り合う面]。 */
const nonTextPairs: ReadonlyArray<readonly [string, string, readonly Surface[]]> = [
  ['入力欄・選択の境界', '--line-strong', surfaces],
  ['フォーカスの輪郭', '--focus', surfaces],
  ['主なボタンの面', '--accent-strong', ['--paper', '--sheet']],
  ['柿の印・選んだナビの線', '--brand', ['--paper', '--sheet']],
  ['今の時刻の線', '--danger', ['--sheet']],
  ['切り替えのつまみ（オフ）', '--sheet-raised', ['--line-strong']],
  ['切り替えのつまみ（オン）', '--sheet-raised', ['--success']],
  ...(['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'] as const).map((chart) => [`図表の色 ${chart}`, chart, surfaces] as const),
];

describe('配色の濃さ（A11）', () => {
  it('10のテーマを確かめる', () => { expect(allThemes).toHaveLength(10); });

  for (const theme of allThemes) {
    describe(theme, () => {
      const tokens = tokensOf(theme);
      const color = (name: string) => rgb(tokens[name]);
      const surface = (value: Surface) => typeof value === 'string' ? color(value) : mix(color(value[0]), value[1], color(value[2]));

      it('色の役割をすべて、6桁の16進数で持つ', () => {
        expect(colorRoles.filter((name) => !/^#[0-9a-f]{6}$/.test(tokens[name] ?? ''))).toEqual([]);
      });

      it('昼のテーマは自分の値を持ち、標準の値を借りない', () => {
        if (theme === 'light') return;
        const own = Object.assign({}, ...rules.filter((rule) => rule.selectors.includes(`[data-theme='${theme}']`)).map((rule) => rule.values));
        expect(colorRoles.filter((name) => !own[name])).toEqual([]);
      });

      for (const [label, text, backgrounds] of textPairs) {
        for (const background of backgrounds) {
          it(`${label}（${text}）は ${surfaceLabel(background)} の上で 4.5:1 以上`, () => {
            expect(contrast(color(text), surface(background))).toBeGreaterThanOrEqual(4.5);
          });
        }
      }

      for (const [label, mark, neighbours] of nonTextPairs) {
        for (const neighbour of neighbours) {
          it(`${label}（${mark}）は ${surfaceLabel(neighbour)} と 3:1 以上`, () => {
            expect(contrast(color(mark), surface(neighbour))).toBeGreaterThanOrEqual(3);
          });
        }
      }
    });
  }

  it('夜のテーマは暗い紙の上に明るい文字をのせ、color-scheme も dark にする', () => {
    for (const theme of allThemes) {
      const tokens = tokensOf(theme);
      expect(luminance(rgb(tokens['--paper'])) < luminance(rgb(tokens['--ink']))).toBe(isNightTheme(theme));
    }
    expect(tokensCss).toMatch(/\[data-theme='dusk'\], \[data-theme\$='-night'\] \{\s*color-scheme: dark;/);
  });

  it('文字の大きさのトークンは 12px 以上、時間のトークンは 100〜300ms', () => {
    const root = tokensOf('light');
    const sizes = Object.entries(root).filter(([name]) => name.startsWith('--text-')).map(([, value]) => parseFloat(value) * 16);
    expect(sizes).toEqual([12, 14, 16, 18, 22, 28, 36, 44]);
    const durations = Object.entries(root).filter(([name]) => name.startsWith('--duration-')).map(([, value]) => parseFloat(value));
    expect(durations).toEqual([100, 150, 200, 250, 300]);
    const spaces = Object.entries(root).filter(([name]) => name.startsWith('--space-')).map(([, value]) => parseFloat(value) * 16);
    expect(spaces).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
  });

  it('予備の値なしで使う名前は、すべて定義している（--surface のような未定義の名前を残さない）', () => {
    const sheets = [tokensCss, themesCss, globalCss, managementCss];
    const defined = new Set(sheets.flatMap((css) => [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(([, name]) => name)));
    const used = [...new Set(sheets.flatMap((css) => [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(([, name]) => name)))];
    // 予定の帯の位置は、画面の部品が style の変数（--start・--length・--column・--columns）で渡す。
    const setByComponents = new Set(['--start', '--length', '--column', '--columns']);
    expect(used.filter((name) => !defined.has(name) && !setByComponents.has(name))).toEqual([]);
  });
});
