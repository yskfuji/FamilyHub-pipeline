#!/usr/bin/env node
/**
 * Web の見た目のトークン（src/design-system/tokens.css・themes.css）を、iOS の Swift に書き出す。
 * 値は手で写さない。テーマの値の決め方は src/design-system/themes.test.ts と同じ（:root、テーマ、夜の共通の規則を書いた順に重ねる）。
 *
 *   node scripts/ios/export-tokens.mjs           # 書き出す
 *   node scripts/ios/export-tokens.mjs --check   # 書き出した物が古ければ止める
 */
import { readFileSync } from 'node:fs';
import { writeGenerated } from './generated.mjs';

const themes = ['light', 'dusk', 'matcha', 'matcha-night', 'sakura', 'sakura-night', 'warm', 'warm-night', 'modern', 'modern-night'];
const palettes = [['standard', '標準', 'light', 'dusk'], ['matcha', '抹茶', 'matcha', 'matcha-night'], ['sakura', '桜', 'sakura', 'sakura-night'], ['warm', '紅葉', 'warm', 'warm-night'], ['modern', '川', 'modern', 'modern-night']];
/** テーマごとに持つ色。themes.test.ts の colorRoles に、柿の印・挿絵の地・幕・写真の背景を足したもの。 */
const colorRoles = [
  'paper', 'paper-deep', 'sheet', 'sheet-raised', 'ink', 'ink-soft', 'ink-faint', 'line', 'line-strong',
  'accent', 'accent-strong', 'on-accent', 'brand', 'brand-soft', 'on-brand', 'attention', 'attention-soft',
  'info', 'info-soft', 'danger', 'danger-soft', 'success', 'success-soft', 'moss', 'moss-soft', 'gold', 'focus',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6',
  'kaki', 'kaki-soft', 'kaki-stem', 'art-ground', 'scrim', 'scrim-soft', 'media-backdrop',
];

function blocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, prelude, body]) => ({
      selectors: prelude.split(',').map((part) => part.trim()).filter(Boolean),
      values: Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
    }))
    .filter((block) => !block.selectors.some((selector) => selector.startsWith('@')));
}

const tokensCss = readFileSync('src/design-system/tokens.css', 'utf8');
// 幅で変わる値（@media の中）は、iOS では画面の配置で決めるので読まない。
const withoutMedia = tokensCss.replace(/@media[^{]*\{\s*:root\s*\{[^}]*\}\s*\}/g, '');
const rules = [...blocks(withoutMedia), ...blocks(readFileSync('src/design-system/themes.css', 'utf8'))];
const applies = (selector, theme) => selector === ':root' || selector === `[data-theme='${theme}']` || (selector === "[data-theme$='-night']" && theme.endsWith('-night'));
const tokensOf = (theme) => Object.assign({}, ...rules.filter((rule) => rule.selectors.some((selector) => applies(selector, theme))).map((rule) => rule.values));

function resolve(tokens, value, seen = new Set()) {
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/);
  if (!reference) return value;
  if (seen.has(reference[1])) throw new Error(`circular token ${reference[1]}`);
  seen.add(reference[1]);
  return resolve(tokens, tokens[reference[1]], seen);
}

/** #rrggbb か rgb(r g b / a%) を、0〜255 の RGB と 0〜1 の不透明度にする。 */
function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
  const rgb = value.match(/^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)%\)$/);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: Number(rgb[4]) / 100 };
  throw new Error(`unsupported colour ${value}`);
}

const camel = (name) => name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const swiftCase = (theme) => camel(theme);
const rem = (value) => {
  const match = value.match(/^([\d.]+)(rem|px)$/);
  if (!match) throw new Error(`unsupported length ${value}`);
  return match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
};
const number = (value) => Number(value);
const ms = (value) => Number(value.replace('ms', ''));

const root = tokensOf('light');
const pick = (prefix, convert) => Object.entries(root).filter(([name]) => name.startsWith(prefix)).map(([name, value]) => [camel(name.slice(2)), convert(value)]);
const lengthGroups = [
  ['TextSize', pick('--text-', rem)],
  ['Leading', pick('--leading-', number)],
  ['Weight', pick('--weight-', number)],
  ['Space', pick('--space-', rem)],
  ['Radius', pick('--radius-', rem)],
  ['Layout', pick('--layout-', rem)],
  ['Duration', pick('--duration-', ms)],
];

const colourLine = (theme) => {
  const tokens = tokensOf(theme);
  const fields = colorRoles.map((role) => {
    const value = tokens[`--${role}`];
    if (!value) throw new Error(`${theme} has no --${role}`);
    const { r, g, b, a } = parseColor(resolve(tokens, value));
    return `      ${camel(role)}: RGBA(${r}, ${g}, ${b}, ${a})`;
  });
  return `    case .${swiftCase(theme)}:\n      return ThemeColors(\n${fields.join(',\n')}\n      )`;
};

const swift = `// 生成したファイル。手で書き換えない。node scripts/ios/export-tokens.mjs で作り直す。
// 元: src/design-system/tokens.css、src/design-system/themes.css、src/domain/theme.ts

/// sRGB の色（0〜255）と不透明度（0〜1）。
public struct RGBA: Sendable, Hashable {
  public let red: Int
  public let green: Int
  public let blue: Int
  public let alpha: Double
  public init(_ red: Int, _ green: Int, _ blue: Int, _ alpha: Double) {
    self.red = red; self.green = green; self.blue = blue; self.alpha = alpha
  }
}

/// data-theme の値。
public enum ThemeName: String, CaseIterable, Sendable {
${themes.map((theme) => `  case ${swiftCase(theme)} = "${theme}"`).join('\n')}

  public var isNight: Bool { self == .dusk || rawValue.hasSuffix("-night") }
}

/// 配色の組。standard が既定。
public enum ThemePalette: String, CaseIterable, Sendable {
${palettes.map(([value]) => `  case ${value}`).join('\n')}

  public var label: String {
    switch self {
${palettes.map(([value, label]) => `    case .${value}: "${label}"`).join('\n')}
    }
  }

  public func theme(night: Bool) -> ThemeName {
    switch self {
${palettes.map(([value, , day, night]) => `    case .${value}: night ? .${swiftCase(night)} : .${swiftCase(day)}`).join('\n')}
    }
  }
}

/// テーマごとの色の役割。名前は CSS の変数（--paper など）を camelCase にしたもの。
public struct ThemeColors: Sendable, Hashable {
${colorRoles.map((role) => `  public let ${camel(role)}: RGBA`).join('\n')}
}

extension ThemeName {
  public var colors: ThemeColors {
    switch self {
${themes.map(colourLine).join('\n')}
    }
  }
}

${lengthGroups.map(([name, entries]) => `/// --${name.toLowerCase()} の値（pt。1rem = 16pt）。
public enum Token${name} {
${entries.map(([key, value]) => `  public static let ${/^\d/.test(key) ? `_${key}` : key}: Double = ${value}`).join('\n')}
}`).join('\n\n')}
`;

writeGenerated('ios/Packages/FamilyHubKit/Sources/FHDesign/Generated/Tokens.swift', swift);
