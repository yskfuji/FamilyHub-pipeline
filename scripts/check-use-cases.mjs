import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../docs/verification/use-cases.json', import.meta.url), 'utf8'));
const ranges = (prefix, count) => Array.from({ length: count }, (_, index) => `UC-${prefix}${String(index + 1).padStart(2, '0')}`);
const expected = new Set([
  ...ranges('A', 15), ...ranges('H', 13), ...ranges('D', 2), ...ranges('C', 8),
  ...ranges('T', 5), ...ranges('M', 6), ...ranges('B', 12), ...ranges('R', 3),
  ...ranges('S', 4), 'UC-N01', ...ranges('P', 4), ...ranges('F', 6), ...ranges('X', 2), ...ranges('L', 6),
  ...ranges('G', 6), ...ranges('E', 5), ...ranges('Y', 5), ...ranges('O', 4),
]);
const ids = catalog.cases.map((item) => item.id);
const actual = new Set(ids);
const missing = [...expected].filter((id) => !actual.has(id));
const extra = [...actual].filter((id) => !expected.has(id));
const incomplete = catalog.cases.filter((item) => !item.title || !item.products?.length || !item.roles?.length || !item.success || !item.failures?.length || !item.recovery);
if (ids.length !== actual.size || missing.length || extra.length || incomplete.length) {
  throw new Error(`use-case catalog invalid: duplicates=${ids.length - actual.size}, missing=${missing}, extra=${extra}, incomplete=${incomplete.map((item) => item.id)}`);
}
// capability は null（公開・本人の操作）か、実在する能力だけを許す。
const types = await readFile(new URL('../src/domain/types.ts', import.meta.url), 'utf8');
const known = new Set([...(types.match(/export type Capability =([^;]+);/)?.[1] ?? '').matchAll(/'([a-z.]+)'/g)].map((match) => match[1]));
const unknownCapabilities = catalog.cases.filter((item) => item.capability !== null && !known.has(item.capability)).map((item) => `${item.id}: ${item.capability}`);
if (known.size === 0 || unknownCapabilities.length) throw new Error(`use-case catalog names unknown capabilities: ${unknownCapabilities}`);
// 段階9〜11で足した使い方は、試験を名指しする（「ファイル#試験の名前の一部」）。名指しした試験が実在することを確かめる。
const mustName = ['UC-A15', 'UC-H13', 'UC-O04', 'UC-B10', 'UC-B11', 'UC-B12', 'UC-M06', 'UC-Y05', 'UC-H11', 'UC-C08', 'UC-G06', 'UC-E05'];
const unnamed = mustName.filter((id) => !catalog.cases.find((item) => item.id === id)?.tests?.length);
const broken = [];
for (const item of catalog.cases) {
  for (const reference of item.tests ?? []) {
    const [file, name] = reference.split('#');
    let source = '';
    try { source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8'); } catch { broken.push(`${item.id}: ${file} がない`); continue; }
    if (!name || !source.includes(name)) broken.push(`${item.id}: ${file} に「${name}」がない`);
  }
}
if (unnamed.length || broken.length) throw new Error(`use-case catalog test references: unnamed=${unnamed}; broken=${broken.join(' / ')}`);
const named = catalog.cases.filter((item) => item.tests?.length);
console.log(`Use-case catalog: ${ids.length} entries, no duplicates or omissions, capabilities all exist; ${named.length} name ${named.reduce((sum, item) => sum + item.tests.length, 0)} tests that exist.`);
