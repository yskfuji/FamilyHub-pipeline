import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const diagrams = [
  { source: 'docs/data-model.mmd', output: 'docs/er.svg', title: 'Family Hub データモデル', description: 'server/db/migrations.ts が作る本体のSQLiteの表、server/audit/schema.ts が作る監査の記録のファイル（audit.db）の表、records 表にJSON文書として保存する記録の種類。', kind: 'er' },
  { source: 'docs/interaction-flow.mmd', output: 'docs/interaction-flow.svg', title: 'Family Hub 操作・認可フロー', description: '操作入口から認可、command、Gateway、対象エンティティ、監査記録までの責務境界。', kind: 'flow' },
];

const mmdc = resolve('node_modules/.bin/mmdc');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const browserCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
if (!browserPath) {
  throw new Error('Mermaid描画に使う既存のChrome/Chromiumが見つかりません。PUPPETEER_EXECUTABLE_PATHを指定してください。');
}

for (const diagram of diagrams) {
  const sourcePath = resolve(diagram.source);
  const outputPath = resolve(diagram.output);
  const source = await readFile(sourcePath, 'utf8');
  if (diagram.kind === 'er') {
    // 図と実際の保存先のずれを止める。表は移行の SQL から、文書の種類は保存の部品から読む。
    const entities = new Set([...source.matchAll(/^\s{2}([A-Za-z_]+)\s*\{/gm)].map((match) => match[1]));
    const migrations = await readFile(resolve('server/db/migrations.ts'), 'utf8');
    const store = await readFile(resolve('server/db/aggregateStore.ts'), 'utf8');
    // 本体の DB の表（後の変更で消した表を除く）と、監査の記録のファイル（audit.db）の表。
    const dropped = new Set([...migrations.matchAll(/DROP TABLE (\w+)/g)].map((match) => match[1]));
    const auditSchema = await readFile(resolve('server/audit/schema.ts'), 'utf8');
    const tables = [...new Set([...[...migrations.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]).filter((name) => !dropped.has(name)), ...[...auditSchema.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1])])];
    const collections = [...store.matchAll(/^const (?:lists|mediaLists) = \[([^\]]+)\]/gm)].flatMap((match) => [...match[1].matchAll(/'(\w+)'/g)].map((name) => name[1]));
    const expected = [...tables, ...collections, 'archive', 'meta'];
    const missing = expected.filter((name) => !entities.has(name));
    const extra = [...entities].filter((name) => !expected.includes(name));
    if (tables.length === 0 || collections.length === 0 || missing.length || extra.length) throw new Error(`ER drift: missing ${missing.join(', ') || 'none'}; not stored anywhere: ${extra.join(', ') || 'none'}`);
    const relations = [...source.matchAll(/^\s{2}[A-Za-z_]+\s+[|}o]\S*\s+[A-Za-z_]+\s*:\s+[A-Za-z_]+/gm)].length;
    if (relations === 0) throw new Error('ER drift: no relationships found');
    console.log(`ER: ${tables.length} tables and ${collections.length + 2} document kinds, ${relations} relationships.`);
  }
  execFileSync(mmdc, ['-i', sourcePath, '-o', outputPath, '-t', 'neutral', '-b', 'transparent'], {
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: browserPath },
  });
  let svg = await readFile(outputPath, 'utf8');
  if (!svg.includes('<svg') || !svg.includes('<path')) throw new Error(`${diagram.output}: rendered relationships are missing`);
  // Mermaid も role を付ける。同じ属性が2つあると SVG として読めなくなるので、先に外す。
  svg = svg.replace(/^<svg [^>]*>/, (tag) => tag.replace(/ role="[^"]*"/, ''))
    .replace('<svg ', `<svg role="img" aria-labelledby="diagram-title diagram-description" `)
    .replace(/(<svg[^>]*>)/, `$1<title id="diagram-title">${diagram.title}</title><desc id="diagram-description">${diagram.description}</desc><!-- source-sha256:${digest(source)} -->`);
  await writeFile(outputPath, svg);
  await writeFile(`${outputPath}.sha256`, `${digest(source)}  ${diagram.source}\n`);
}

console.log('Mermaid CLIでER図と操作・認可フローを再生成しました。');
