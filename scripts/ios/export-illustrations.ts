/**
 * 挿絵（src/design-system/illustrations/）を、SwiftUI で描ける形に書き出す。形と色の役割は手で写さない。
 * React で SVG にしてから、要素ごとに「絶対座標の path（M・L・C・Z）・塗りの色・線の色・点線」にする。
 * 色はテーマの変数の名前（--brand-soft など）のまま残し、アプリがテーマの色に置き換える（夜のテーマでも変わる）。
 * 線の太さは Web と同じく画面の大きさによらない（vector-effect: non-scaling-stroke）ので、アプリが決める。
 *
 *   npx tsx scripts/ios/export-illustrations.ts [--check]
 */
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyAlbums } from '../../src/design-system/illustrations/EmptyAlbums';
import { EmptyBudget } from '../../src/design-system/illustrations/EmptyBudget';
import { EmptyDone } from '../../src/design-system/illustrations/EmptyDone';
import { EmptyError } from '../../src/design-system/illustrations/EmptyError';
import { EmptyEvents } from '../../src/design-system/illustrations/EmptyEvents';
import { EmptyMemos } from '../../src/design-system/illustrations/EmptyMemos';
import { EmptyOffline } from '../../src/design-system/illustrations/EmptyOffline';
import { EmptyPlaces } from '../../src/design-system/illustrations/EmptyPlaces';
import { EmptySearch } from '../../src/design-system/illustrations/EmptySearch';
import { EmptyTasks } from '../../src/design-system/illustrations/EmptyTasks';
import { OnboardingHousehold, OnboardingSharing, OnboardingWelcome } from '../../src/design-system/illustrations/OnboardingScenes';
import { SeasonScene } from '../../src/design-system/illustrations/SeasonScene';
import { ellipsePath, identity, multiply, normalizePath, parseMarkup, parseTransform, rectPath, transformPath } from './svg.mjs';
import { writeGenerated } from './generated.mjs';

type Node = { name: string; attributes: Record<string, string>; children: Node[] };
type Command = [string, ...number[]];

const scenes: Array<[string, string, ComponentType]> = [
  ['emptyAlbums', 'EmptyAlbums', EmptyAlbums], ['emptyBudget', 'EmptyBudget', EmptyBudget], ['emptyDone', 'EmptyDone', EmptyDone],
  ['emptyError', 'EmptyError', EmptyError], ['emptyEvents', 'EmptyEvents', EmptyEvents], ['emptyMemos', 'EmptyMemos', EmptyMemos],
  ['emptyOffline', 'EmptyOffline', EmptyOffline], ['emptyPlaces', 'EmptyPlaces', EmptyPlaces], ['emptySearch', 'EmptySearch', EmptySearch],
  ['emptyTasks', 'EmptyTasks', EmptyTasks],
  ['onboardingHousehold', 'OnboardingHousehold', OnboardingHousehold], ['onboardingSharing', 'OnboardingSharing', OnboardingSharing], ['onboardingWelcome', 'OnboardingWelcome', OnboardingWelcome],
  ...(['spring', 'summer', 'autumn', 'winter'] as const).map((season) => [`season${season[0].toUpperCase()}${season.slice(1)}`, `SeasonScene season="${season}"`, () => createElement(SeasonScene, { season })] as [string, string, ComponentType]),
];

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, character: string) => character.toUpperCase());
const colors = new Set<string>();
/** 'var(--brand-soft)' → 'brandSoft'。none なら null。 */
function colorOf(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'none') return null;
  const match = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (!match) throw new Error(`挿絵の色はテーマの変数だけにする: ${value}`);
  colors.add(camel(match[1]));
  return camel(match[1]);
}

interface Element { path: Command[]; fill: string | null; stroke: string | null; dash: number[] }
interface Inherited { matrix: number[]; fill: string | null; stroke: string | null; dash: number[] }

function walk(node: Node, inherited: Inherited, out: Element[]) {
  const a = node.attributes;
  const fill = colorOf(a.fill); const stroke = colorOf(a.stroke);
  const state: Inherited = {
    matrix: a.transform ? multiply(inherited.matrix, parseTransform(a.transform)) : inherited.matrix,
    fill: fill === undefined ? inherited.fill : fill,
    stroke: stroke === undefined ? inherited.stroke : stroke,
    dash: a['stroke-dasharray'] ? a['stroke-dasharray'].split(/[\s,]+/).map(Number) : inherited.dash,
  };
  const n = (key: string, fallback = 0) => (a[key] === undefined ? fallback : Number(a[key]));
  let path: Command[] | null = null;
  if (node.name === 'path') path = normalizePath(a.d) as Command[];
  else if (node.name === 'circle') path = ellipsePath(n('cx'), n('cy'), n('r'), n('r')) as Command[];
  else if (node.name === 'ellipse') path = ellipsePath(n('cx'), n('cy'), n('rx'), n('ry')) as Command[];
  else if (node.name === 'rect') path = rectPath(n('x'), n('y'), n('width'), n('height'), n('rx', n('ry')), n('ry', n('rx'))) as Command[];
  else if (node.name !== 'g' && node.name !== 'svg') throw new Error(`挿絵に使えない要素: ${node.name}`);
  if (path) out.push({ path: transformPath(path, state.matrix) as Command[], fill: state.fill, stroke: state.stroke, dash: state.dash });
  for (const child of node.children) walk(child, state, out);
}

const number = (value: number) => { const text = value.toFixed(2).replace(/\.?0+$/, ''); return text === '-0' ? '0' : text; };
const pathText = (commands: Command[]) => commands.map(([kind, ...values]) => `${kind}${values.map(number).join(' ')}`).join('');

const blocks: string[] = [];
const sizes: string[] = [];
for (const [name, source, component] of scenes) {
  const svg = parseMarkup(renderToStaticMarkup(createElement(component))) as Node;
  if (svg.attributes['aria-hidden'] !== 'true') throw new Error(`${source}: 挿絵は飾り（aria-hidden）にする`);
  const [, , width, height] = svg.attributes.viewBox.split(/\s+/).map(Number);
  const elements: Element[] = [];
  walk(svg, { matrix: identity, fill: null, stroke: null, dash: [] }, elements);
  sizes.push(`    case .${name}: CGSize(width: ${width}, height: ${height})`);
  const items = elements.map((element) => `      .init(path: "${pathText(element.path)}", fill: ${element.fill ? `.${element.fill}` : 'nil'}, stroke: ${element.stroke ? `.${element.stroke}` : 'nil'}${element.dash.length ? `, dash: [${element.dash.join(', ')}]` : ''}),`);
  blocks.push(`    // ${source}\n    case .${name}: [\n${items.join('\n')}\n    ]`);
}

const colorList = [...colors].sort();
const swift = `// 生成したファイル。手で書き換えない。npx tsx scripts/ios/export-illustrations.ts で作り直す。
// 元: src/design-system/illustrations/*.tsx
import CoreGraphics

/// 挿絵。どれも飾りで、意味は隣の文が伝える（読み上げない）。
public enum Illustration: String, CaseIterable, Sendable {
${scenes.map(([name]) => `  case ${name}`).join('\n')}

  /// 元の SVG の viewBox の大きさ。
  public var size: CGSize {
    switch self {
${sizes.join('\n')}
    }
  }

  /// 描く順の要素。座標は viewBox の中の絶対座標。
  public var elements: [IllustrationElement] {
    switch self {
${blocks.join('\n')}
    }
  }
}

/// 挿絵の色の役割（テーマの変数）。
public enum ArtColor: String, CaseIterable, Sendable {
${colorList.map((color) => `  case ${color}`).join('\n')}

  public func rgba(in colors: ThemeColors) -> RGBA {
    switch self {
${colorList.map((color) => `    case .${color}: colors.${color}`).join('\n')}
    }
  }
}
`;
writeGenerated('ios/Packages/FamilyHubKit/Sources/FHDesign/Generated/Illustrations.swift', swift);
