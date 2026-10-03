import { readFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../docs/verification/use-cases.json', import.meta.url), 'utf8'));
const ranges = (prefix, count) => Array.from({ length: count }, (_, index) => `UC-${prefix}${String(index + 1).padStart(2, '0')}`);
const expected = new Set([
  ...ranges('A', 8), ...ranges('H', 8), ...ranges('D', 2), ...ranges('C', 5),
  ...ranges('T', 4), ...ranges('M', 4), ...ranges('B', 5), ...ranges('R', 2),
  ...ranges('S', 2), 'UC-N01', ...ranges('P', 3), ...ranges('F', 6), ...ranges('X', 2), ...ranges('L', 5),
]);
const ids = catalog.cases.map((item) => item.id);
const actual = new Set(ids);
const missing = [...expected].filter((id) => !actual.has(id));
const extra = [...actual].filter((id) => !expected.has(id));
const incomplete = catalog.cases.filter((item) => !item.title || !item.products?.length || !item.roles?.length || !item.success || !item.failures?.length || !item.recovery);
if (ids.length !== actual.size || missing.length || extra.length || incomplete.length) {
  throw new Error(`use-case catalog invalid: duplicates=${ids.length - actual.size}, missing=${missing}, extra=${extra}, incomplete=${incomplete.map((item) => item.id)}`);
}
console.log(`Use-case catalog: ${ids.length} entries, no duplicates or omissions.`);
