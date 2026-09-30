import { readFile, writeFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('docs/audits/lighthouse-today.report.json', 'utf8'));
const score = (id) => Math.round((report.categories[id]?.score ?? 0) * 100);
const value = (id) => report.audits[id]?.numericValue;
const summary = {
  performance: score('performance'),
  accessibility: score('accessibility'),
  bestPractices: score('best-practices'),
  lcpMs: value('largest-contentful-paint'),
  cls: value('cumulative-layout-shift'),
  tbtMs: value('total-blocking-time'),
  note: 'INP requires field interaction data; Lighthouse lab proxy reports TBT instead.',
};
await writeFile('docs/audits/lighthouse-summary.json', `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (summary.performance < 90 || summary.accessibility < 100 || summary.bestPractices < 100 || (summary.lcpMs ?? Infinity) >= 2500 || (summary.cls ?? Infinity) >= 0.1) process.exitCode = 1;
