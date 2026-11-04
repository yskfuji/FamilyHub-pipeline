#!/usr/bin/env node
/**
 * 挿絵のゲート（段階10。docs/design/tokens.md の「挿絵」）。src/design-system/illustrations/ の部品ごとに確かめる。
 * - 大きさ: 部品のファイルと、そこから読む共通の部品（parts.tsx など）を合わせて gzip -9 にし、4,096 バイト以下。
 * - 色: fill・stroke・stop-color などに書けるのは var(--…)・none・currentColor だけ。16進数・rgb()・hsl() などの直書きと、
 *   色の名前（white・black・red など）は、属性・式・style のどこに書いても失敗にする。
 * - 読み上げ: どの <svg> にも aria-hidden="true" と focusable="false" がある。<title>・<desc>・role・aria-label は書かない
 *   （挿絵は飾り。意味は隣の見出しと文が伝える）。
 * 失敗を注入して確かめた（docs/acceptance/criteria.md の「挿絵のゲート」）。
 */
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'src/design-system/illustrations');
const MAX_GZIP = 4096;
const colorAttributes = new Set(['fill', 'stroke', 'stopColor', 'stop-color', 'floodColor', 'flood-color', 'lightingColor', 'lighting-color', 'color']);
const allowedColor = /^(var\(--[a-z0-9-]+\)|none|currentColor|transparent)$/;
const rawColor = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
// CSS の色の名前（文字列の中に単語として現れたら失敗）。
const namedColors = /\b(aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgray|lightgreen|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegreen|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/i;

const failures = [];
const report = [];
const files = (await readdir(dir)).filter((name) => name.endsWith('.tsx') && !name.includes('.test.')).sort();
const sources = new Map(await Promise.all(files.map(async (name) => [name, await readFile(join(dir, name), 'utf8')])));

/** 文字列（引用符・テンプレートの中身）が色として許されるか。var(--…) の中の名前は見ない。 */
function checkString(file, line, text, where) {
  const stripped = text.replace(/var\(--[a-z0-9-]+\)/g, '');
  if (rawColor.test(stripped)) failures.push(`${file}:${line} hard-coded colour in ${where}: ${text}`);
  else if (namedColors.test(stripped)) failures.push(`${file}:${line} named colour in ${where}: ${text}`);
}

for (const [name, source] of sources) {
  const file = relative(root, join(dir, name));
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  let svgCount = 0;
  const visit = (node) => {
    // 文字列はすべて色の直書きを確かめる（属性・オブジェクト・式のどこに書いても同じ）。コメントは対象外。
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const parent = node.parent;
      const inImport = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
      if (!inImport) checkString(file, lineOf(node), node.text, 'a string');
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(ast);
      const attributes = new Map();
      for (const property of opening.attributes.properties) {
        if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(ast), property);
      }
      if (['title', 'desc'].includes(tag)) failures.push(`${file}:${lineOf(opening)} <${tag}> gives the illustration a name; illustrations are decorative`);
      for (const banned of ['role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'tabIndex', 'style']) {
        if (attributes.has(banned)) failures.push(`${file}:${lineOf(opening)} ${banned} is not allowed in an illustration${banned === 'style' ? ' (use attributes with theme variables)' : ''}`);
      }
      for (const [attribute, property] of attributes) {
        if (!colorAttributes.has(attribute) || !property.initializer) continue;
        if (ts.isStringLiteral(property.initializer) && !allowedColor.test(property.initializer.text)) failures.push(`${file}:${lineOf(property)} ${attribute}="${property.initializer.text}" must be var(--…), none or currentColor`);
      }
      if (tag === 'svg') {
        svgCount += 1;
        const value = (key) => { const property = attributes.get(key); return property?.initializer && ts.isStringLiteral(property.initializer) ? property.initializer.text : null; };
        if (value('aria-hidden') !== 'true') failures.push(`${file}:${lineOf(opening)} <svg> needs aria-hidden="true"`);
        if (value('focusable') !== 'false') failures.push(`${file}:${lineOf(opening)} <svg> needs focusable="false"`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const shared = [...source.matchAll(/from '\.\/([A-Za-z0-9]+)'/g)].map(([, module]) => `${module}.tsx`).filter((module) => sources.has(module));
  if (name === 'parts.tsx') continue;
  if (svgCount === 0) failures.push(`${file}: no <svg> (each illustration file draws its own root with aria-hidden)`);
  const bytes = gzipSync(Buffer.from([source, ...shared.map((module) => sources.get(module))].join('\n')), { level: 9 }).length;
  report.push(`${basename(name, '.tsx')}: ${bytes} B gzip${shared.length ? ` (with ${shared.join(', ')})` : ''}`);
  if (bytes > MAX_GZIP) failures.push(`${file}: ${bytes} bytes gzip is more than ${MAX_GZIP}`);
}

if (failures.length) {
  console.error(`audit-illustrations: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`audit-illustrations: ${report.length} illustration files, each within ${MAX_GZIP} bytes gzip, theme colours only, decorative to assistive technology`);
for (const line of report) console.log(`  ${line}`);
