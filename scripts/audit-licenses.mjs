#!/usr/bin/env node
/**
 * 本番で使う依存のライセンスを確かめ、一覧を docs/legal/third-party-licenses.md に残す（docs/legal/legal-review-2026-11.md）。
 *
 *   node scripts/audit-licenses.mjs           # 許す一覧に入っているか、一覧のファイルが新しいかを確かめる
 *   node scripts/audit-licenses.mjs --write   # 一覧のファイルを作り直す
 *
 * 画面の配信物に入る部品の全文のライセンスは、ビルドが licenses.md として出す（vite.config.ts の build.license）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ALLOWED = new Set(['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense']);
/**
 * 名前を付けた例外。sharp が使う libvips（LGPL-3.0-or-later）は、API の機械の中で動的に読み込むだけで、
 * 利用者に配るもの（画面の配信物）には入らない。LGPL の義務は配るときにかかる。配るなら、LGPL の文と差し替えの方法を添える。
 */
const EXCEPTIONS = [{ pattern: /^@img\/sharp-(libvips-|wasm32|win32-)/, licenses: ['LGPL-3.0-or-later'], reason: 'sharp の libvips。API の機械の中だけで動的に読み込み、利用者に配らない' }];
/** 依存ではない素材。 */
const MATERIALS = [
  { name: 'Noto Serif JP（字形の書き出し）', where: 'src/design-system/wordmark.ts', license: 'OFL-1.1', note: 'ブランドの名前「よりどころ」の SVG の字形。書体そのものは配らない' },
  { name: 'SecLists（頻出のパスワードの一覧）', where: 'src/domain/commonPasswords.json', license: 'MIT', note: '15文字以上の項目だけを、そろえて同梱（scripts/build-password-list.mjs）' },
];

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const rows = [];
const failures = [];
for (const [path, item] of Object.entries(lock.packages)) {
  if (!path || item.dev || item.devOptional) continue;
  const name = path.replace(/.*node_modules\//, '');
  const license = typeof item.license === 'string' ? item.license : '';
  const parts = license.replace(/[()]/g, '').split(/\s+(?:AND|OR)\s+/).filter(Boolean);
  const exception = EXCEPTIONS.find((entry) => entry.pattern.test(name));
  const unknown = parts.filter((part) => !ALLOWED.has(part) && !exception?.licenses.includes(part));
  if (!license) failures.push(`${name}@${item.version}: no license in package-lock.json`);
  else if (unknown.length && !(license.includes(' OR ') && parts.some((part) => ALLOWED.has(part)))) failures.push(`${name}@${item.version}: ${license} is not in the allowed list`);
  rows.push({ name, version: item.version, license, note: exception && parts.some((part) => exception.licenses.includes(part)) ? exception.reason : '' });
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const unique = rows.filter((row, index) => index === 0 || row.name !== rows[index - 1].name || row.version !== rows[index - 1].version);

const text = `# 使っているソフトと素材のライセンス

\`node scripts/audit-licenses.mjs --write\` が \`package-lock.json\` から作る。手で書き換えない。

- 許すライセンス: ${[...ALLOWED].join('、')}。
- 名前を付けた例外: ${EXCEPTIONS.map((entry) => `${entry.licenses.join('・')}（${entry.reason}）`).join('。')}。
- 画面の配信物に入る部品のライセンスの全文は、ビルドが \`licenses.md\` として配信物の中に出す。

## 素材

| 名前 | 置き場所 | ライセンス | 備考 |
|---|---|---|---|
${MATERIALS.map((item) => `| ${item.name} | \`${item.where}\` | ${item.license} | ${item.note} |`).join('\n')}

## 本番で使う依存（${unique.length}件）

| パッケージ | 版 | ライセンス | 備考 |
|---|---|---|---|
${unique.map((row) => `| ${row.name} | ${row.version} | ${row.license} | ${row.note} |`).join('\n')}
`;

const target = 'docs/legal/third-party-licenses.md';
if (process.argv.includes('--write')) writeFileSync(target, text);
else {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch { /* まだない */ }
  if (current !== text) failures.push(`${target} is out of date; run node scripts/audit-licenses.mjs --write`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`License audit passed: ${unique.length} production packages under allowed licenses (${EXCEPTIONS.length} named exception), list in ${target}.`);
