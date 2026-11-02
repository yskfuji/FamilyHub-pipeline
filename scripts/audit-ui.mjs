import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}

const sourceFiles = (await filesUnder(resolve('src'))).filter((file) => (
  extname(file) === '.tsx'
  || file.endsWith('/data/fixtures.ts')
  || file.endsWith('/data/mockGateway.ts')
  || file.includes('/domain/commands/')
  || (/\/domain\/(shift|advisor)\/[^/]+\.ts$/.test(file) && !/\.(test|fixtures)\.ts$/.test(file))
  || file.endsWith('/domain/assistant.ts')
  || file.endsWith('/domain/schemas.ts')
  || file.endsWith('/offline/queue.ts')
  || file.endsWith('/content/ja.ts')
  || file.endsWith('/content/serverMessages.ts')
  || file.endsWith('/content/help.ts')
  || file.endsWith('/content/legal.ts')
  || (/\/features\/place\/[^/]+\.ts$/.test(file) && !file.endsWith('.test.ts'))
  || (/\/features\/showcase\/management\/[^/]+\.ts$/.test(file) && !file.endsWith('.test.ts'))
));
sourceFiles.push(resolve('index.html'), resolve('scripts/build-gallery.mjs'));
const forbidden = [
  ['Family Hub', /Family Hub/i], ['Privacy by boundary', /Privacy by boundary/], ['raw Todo copy', /(?:>|["'`])(?:家族の)?Todo(?:を追加|の期限)?(?:<|["'`])/],
  ['reviewer translation', /レビュアー/], ['series translation', /系列全体/], ['unsafe safety claim', /安全な新しいタブで開く/],
  ['onboarding translation', /Set up/], ['raw timezone label', />Asia\/Tokyo(?:（日本時間）)?</], ['generic resource tab', /['"]リソース['"]/],
  ['consumer implementation term', /WebAuthn ceremony|Fetch Metadata|__Host-|localStorage \/ sessionStorage/],
  ['stiff insight title', /根拠の見える気づき|確信度|この表示の根拠|お約束しないこと/],
  ['implementation-facing copy', /隔離領域|検査済み|共有画面|セッション|参照実装|参照画面|バックエンド|サーバー/],
  ['audit-facing copy', /タッチ対象|44px|200%ズーム|VoiceOver|evidence-pending/],
  ['stiff household copy', /世帯|精算の向き|本日の時間軸|気象コンテキスト/],
  ['stale retry wording', /再送待ち|送信待ち|保存から24時間/],
  ['untranslated time-zone label', /タイムゾーン/],
  ['stiff security tab label', /サインインと安全/],
  ['implied model', /\bAI\b|人工知能|ニューラル|Neural Engine|機械学習/],
];
const failures = [];
// 管理コンソールの見本だけは、本物につながらないことを伝えるために「サーバー」と書く。ほかの語も、ほかの画面も例外にしない。
const consoleSampleDir = `${resolve('src/features/showcase/management')}/`;
for (const file of sourceFiles) {
  const raw = await readFile(file, 'utf8');
  const text = file.startsWith(consoleSampleDir) ? raw.replaceAll('サーバー', '') : raw;
  for (const [label, pattern] of forbidden) if (pattern.test(text)) failures.push(`${file}: ${label}`);
}

const catalogText = await readFile(resolve('src/content/ja.ts'), 'utf8');
const catalogRequirements = [
  ['navigation Today', "today: '今日'"],
  ['task term', "tasks: 'タスク'"],
  ['owner label', "owner: '管理者'"],
  ['membership active label', "active: '利用中'"],
  ['event recurrence label', "future: 'これ以降の予定'"],
  ['task recurrence label', "future: 'これ以降のタスク'"],
  ['external-link label', 'を開く（新しいタブ）'],
];
for (const [label, required] of catalogRequirements) if (!catalogText.includes(required)) failures.push(`content catalog is missing: ${label}`);

// 通常のビルドと実サーバー向けのビルドには、内部監査の面も管理コンソールの見本も入れない。
const auditMarkers = ['/showcase', '内部監査', '表示状態', '検証状況'];
const consoleMarkers = ['/showcase/management', '管理コンソール', 'mgmt-', 'management-console', '見本の運営者', '見本の家族', '見本のバックアップ', '架空のデータ'];
let builtFiles = 0;
for (const [dir, label] of [['dist', 'consumer'], ['dist-http', 'http']]) {
  if (!existsSync(resolve(dir))) { failures.push(`${dir} is missing: build it before this audit`); continue; }
  const files = (await filesUnder(resolve(dir))).filter((file) => ['.js', '.css', '.html', '.map'].includes(extname(file)));
  builtFiles += files.length;
  if (files.some((file) => extname(file) === '.map')) failures.push(`${label} build contains source maps`);
  const built = (await Promise.all(files.filter((file) => extname(file) !== '.map').map((file) => readFile(file, 'utf8')))).join('\n');
  for (const marker of auditMarkers) if (built.includes(marker)) failures.push(`${label} build contains audit marker: ${marker}`);
  for (const marker of consoleMarkers) if (built.includes(marker)) failures.push(`${label} build contains console marker: ${marker}`);
}

// 比較元のアプリの名前をリポジトリに書かない。この検査自身にも書かないよう、語を組み立てる。
const unwantedName = new RegExp(['be', 'lives'].join(''), 'i');
const namedRoots = ['src', 'server', 'docs', 'scripts', 'e2e', 'contracts'];
const namedFiles = [...(await Promise.all(namedRoots.map((root) => filesUnder(resolve(root))))).flat(), resolve('README.md')];
for (const file of namedFiles) {
  if (unwantedName.test(file.slice(resolve('.').length))) failures.push(`${file}: file name must not carry the comparison app's name`);
  if (['.png', '.webm', '.jpg', '.zip'].includes(extname(file))) continue;
  if (unwantedName.test(await readFile(file, 'utf8'))) failures.push(`${file}: must not carry the comparison app's name`);
}

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`UI copy, content-catalog, name, and build-boundary audit passed across ${sourceFiles.length} visible-copy source files, ${namedFiles.length} named-tree files and ${builtFiles} build files.`);
