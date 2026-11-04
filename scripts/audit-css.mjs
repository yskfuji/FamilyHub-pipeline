#!/usr/bin/env node
/**
 * 見た目のトークンのゲート。
 * - 文字の大きさは尺度のトークン（--text-*。12px 以上）だけを使う。
 * - margin・padding・gap に rem や px を直接書かない（--space-* か、名前を付けた配置の値 --layout-* を使う）。
 * - 動きの時間は 300ms 以下。超えてよいのは、下の名前を付けた例外だけ。
 * - 画面の部品の style 属性（TSX）でも、文字の大きさと余白に値を直接書かない。
 * 例外は、どれも理由とともにこのファイルに書く。
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const MAX_DURATION_MS = 300;
const MIN_TEXT_PX = 12;

/** 余白に直接の値を書いてよい宣言。[ファイル, セレクタ, 属性, 理由] */
const spacingExceptions = [
  ['src/design-system/global.css', '.sr-only', 'margin', '見えない文字の定型（1px の枠を外へずらす）。余白ではない'],
];
/** 300ms を超えてよい動き。[ファイル, セレクタ, 理由] */
const durationExceptions = [
  ['src/design-system/global.css', '.slide-zoom', 'スライドショーの写真をゆっくり拡大する演出（計画 B の「動き」でスライドショーは除く）'],
  ['src/design-system/global.css', '.skeleton', '読み込み中の骨組みの繰り返し。遷移ではなく、動きを減らす設定では止める'],
  ['src/design-system/global.css', '.refresh-indicator', '読み込み中の帯の繰り返し。遷移ではなく、動きを減らす設定では止める'],
];

const failures = [];
const used = { spacing: new Set(), duration: new Set() };

async function files(dir, pattern) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path, pattern));
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out;
}

/** 宣言を、属するセレクタとともに取り出す。@media などの中も読む。 */
function declarations(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const result = [];
  const stack = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\n') line += 1;
    if (char === '{') {
      stack.push(text.slice(start, index).trim());
      start = index + 1; startLine = line;
    } else if (char === ';' || char === '}') {
      const chunk = text.slice(start, index);
      const selector = stack.at(-1) ?? '';
      const match = chunk.match(/^\s*(-{0,2}[a-z][a-z0-9-]*)\s*:\s*([\s\S]+?)\s*$/i);
      if (match && selector && !selector.startsWith('@')) result.push({ selector, property: match[1].toLowerCase(), value: match[2], line: startLine + (chunk.slice(0, chunk.search(/\S/)).match(/\n/g)?.length ?? 0) });
      if (char === '}') stack.pop();
      start = index + 1; startLine = line;
    }
  }
  return result;
}

const selectorHas = (selector, wanted) => selector.split(',').some((part) => part.trim().split(/[\s>+~]+/).some((piece) => piece === wanted || piece.startsWith(`${wanted}:`) || piece.startsWith(`${wanted}[`) || piece.startsWith(`${wanted}.`)));
const spacingException = (file, selector, property) => spacingExceptions.find(([path, wanted, prop]) => path === file && selectorHas(selector, wanted) && property.startsWith(prop));
const durationException = (file, selector) => durationExceptions.find(([path, wanted]) => path === file && selectorHas(selector, wanted));

const spacingProperty = /^(margin|padding|gap|row-gap|column-gap)(-.+)?$/;
const rawLength = /(?<![\w-])-?\d*\.?\d+(rem|px|em|pt|ch|ex)\b/;

function checkTokens(file, decls) {
  for (const { selector, property, value, line } of decls) {
    if (/^--text-/.test(property)) {
      const px = value.endsWith('rem') ? parseFloat(value) * 16 : value.endsWith('px') ? parseFloat(value) : NaN;
      if (!(px >= MIN_TEXT_PX)) failures.push(`${file}:${line} ${property} must be ${MIN_TEXT_PX}px or more (is ${value})`);
    }
    if (/^--duration-/.test(property)) {
      const ms = value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
      if (!(ms >= 100 && ms <= MAX_DURATION_MS)) failures.push(`${file}:${line} ${property} must be 100–${MAX_DURATION_MS}ms (is ${value})`);
    }
    if (/^--space-/.test(property) && !/^\d*\.?\d+rem$/.test(value)) failures.push(`${file}:${line} ${property} must be a rem value`);
    void selector;
  }
}

function checkCss(file, decls) {
  for (const { selector, property, value, line } of decls) {
    if (property.startsWith('--')) continue;
    const at = `${file}:${line} ${selector} { ${property}: ${value} }`;
    if (property === 'font-size' || property === 'font') {
      if (property === 'font' && /^(inherit|initial|unset)$/.test(value)) continue;
      const rest = value.replace(/var\(--text-[a-z0-9]+\)/g, '').replace(/\b\d*\.?\d+(vw|vi|cqi|cqw)\b/g, '');
      if (property === 'font-size' && !/var\(--text-/.test(value) && value !== 'inherit') failures.push(`${at}: use a type token (--text-*)`);
      else if (rawLength.test(rest) || /\d%/.test(rest) || /\b(small|smaller|larger|x-small|xx-small|medium)\b/.test(rest)) failures.push(`${at}: use a type token (--text-*)`);
    }
    if (spacingProperty.test(property)) {
      const rest = value.replace(/var\(--(space|layout)-[a-z0-9-]+\)/g, '').replace(/env\([^)]*\)/g, '');
      if (rawLength.test(rest)) {
        const exception = spacingException(file, selector, property);
        if (exception) used.spacing.add(exception);
        else failures.push(`${at}: use a spacing token (--space-*)`);
      }
    }
    if (/^(transition|animation)(-duration|-delay)?$/.test(property)) {
      for (const [, number, unit] of value.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)) {
        const ms = unit === 'ms' ? parseFloat(number) : parseFloat(number) * 1000;
        if (ms <= MAX_DURATION_MS) continue;
        const exception = durationException(file, selector);
        if (exception) used.duration.add(exception);
        else failures.push(`${at}: ${number}${unit} is longer than ${MAX_DURATION_MS}ms`);
      }
    }
  }
}

/** TSX の style={{ ... }} で、文字の大きさと余白に値を直接書いていないか。 */
function checkTsx(file, source) {
  const pattern = /\b(fontSize|margin\w*|padding\w*|gap|rowGap|columnGap)\s*:\s*(['"`])([^'"`]*)\2|\b(fontSize|margin\w*|padding\w*|gap|rowGap|columnGap)\s*:\s*(\d+(?:\.\d+)?)\b/g;
  for (const match of source.matchAll(pattern)) {
    const property = match[1] ?? match[4];
    const value = match[3] ?? match[5];
    const line = source.slice(0, match.index).split('\n').length;
    if (match[5] !== undefined && Number(value) === 0) continue;
    const rest = String(value).replace(/var\(--(space|layout|text)-[a-z0-9-]+\)/g, '');
    if (match[5] !== undefined || rawLength.test(rest)) failures.push(`${file}:${line} style ${property}: ${value} — use a class with tokens`);
  }
}

const cssFiles = await files(resolve(root, 'src'), /\.css$/);
for (const path of cssFiles) {
  const file = relative(root, path);
  const decls = declarations(await readFile(path, 'utf8'));
  checkTokens(file, decls);
  checkCss(file, decls);
}
for (const path of await files(resolve(root, 'src'), /\.tsx$/)) checkTsx(relative(root, path), await readFile(path, 'utf8'));

for (const exception of [...spacingExceptions, ...durationExceptions]) {
  if (!used.spacing.has(exception) && !used.duration.has(exception)) failures.push(`unused exception (remove it): ${exception[0]} ${exception[1]}`);
}

if (failures.length) {
  console.error(`audit-css: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`audit-css: ${cssFiles.length} CSS files use type, spacing and motion tokens (${spacingExceptions.length + durationExceptions.length} named exceptions)`);
