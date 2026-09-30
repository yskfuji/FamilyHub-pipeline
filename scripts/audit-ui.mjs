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
  || file.endsWith('/domain/schemas.ts')
  || file.endsWith('/offline/queue.ts')
  || file.endsWith('/content/ja.ts')
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
];
const failures = [];
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
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

const distFiles = (await filesUnder(resolve('dist'))).filter((file) => ['.js', '.html', '.map'].includes(extname(file)));
if (distFiles.some((file) => extname(file) === '.map')) failures.push('consumer build contains source maps');
const distText = (await Promise.all(distFiles.filter((file) => extname(file) !== '.map').map((file) => readFile(file, 'utf8')))).join('\n');
for (const marker of ['/showcase', '内部監査', '表示状態', '検証状況']) if (distText.includes(marker)) failures.push(`consumer build contains audit marker: ${marker}`);

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`UI copy, content-catalog, and consumer-boundary audit passed across ${sourceFiles.length} visible-copy source files and ${distFiles.length} build files.`);
