import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const diagrams = [
  { source: 'docs/data-model.mmd', output: 'docs/er.svg', title: 'Family Hub 目標ER図', description: 'OpenAPIとTypeScriptに対応する設計契約。実データベースの存在を証明する図ではありません。', kind: 'er' },
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
    const entities = [...source.matchAll(/^\s{2}([A-Z][A-Za-z]+)\s*\{/gm)].length;
    const relations = [...source.matchAll(/^\s{2}[A-Z][A-Za-z]+\s+[^:]+:\s+[a-z_]+/gm)].length;
    if (entities !== 21 || relations !== 29) throw new Error(`ER contract drift: expected 21 entities and 29 relations, found ${entities} and ${relations}`);
  }
  execFileSync(mmdc, ['-i', sourcePath, '-o', outputPath, '-t', 'neutral', '-b', 'transparent'], {
    stdio: 'inherit',
    env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: browserPath },
  });
  let svg = await readFile(outputPath, 'utf8');
  if (!svg.includes('<svg') || !svg.includes('<path')) throw new Error(`${diagram.output}: rendered relationships are missing`);
  svg = svg.replace('<svg ', `<svg role="img" aria-labelledby="diagram-title diagram-description" `)
    .replace(/(<svg[^>]*>)/, `$1<title id="diagram-title">${diagram.title}</title><desc id="diagram-description">${diagram.description}</desc><!-- source-sha256:${digest(source)} -->`);
  await writeFile(outputPath, svg);
  await writeFile(`${outputPath}.sha256`, `${digest(source)}  ${diagram.source}\n`);
}

console.log('Mermaid CLIでER図と操作・認可フローを再生成しました。');
