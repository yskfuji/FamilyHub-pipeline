import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}

const sourceFiles = (await filesUnder(resolve('src'))).filter((file) => (
  (extname(file) === '.tsx' && !file.includes('/features/showcase/'))
  || file.endsWith('/data/fixtures.ts')
  || file.endsWith('/content/catalog.ts')
));
const forbidden = [
  ['FAMILY HUB', /FAMILY HUB/], ['Privacy by boundary', /Privacy by boundary/], ['raw Todo copy', /(?:>|["'`])(?:家族の)?Todo(?:を追加|の期限)?(?:<|["'`])/],
  ['reviewer translation', /レビュアー/], ['series translation', /系列全体/], ['unsafe safety claim', /安全な新しいタブで開く/],
  ['onboarding translation', /Set up/], ['raw timezone label', />Asia\/Tokyo(?:（日本時間）)?</], ['generic resource tab', /['"]リソース['"]/],
  ['consumer implementation term', /WebAuthn ceremony|Fetch Metadata|__Host-|localStorage \/ sessionStorage/],
];
const failures = [];
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
  for (const [label, pattern] of forbidden) if (pattern.test(text)) failures.push(`${file}: ${label}`);
}

const distFiles = (await filesUnder(resolve('dist'))).filter((file) => ['.js', '.html', '.map'].includes(extname(file)));
if (distFiles.some((file) => extname(file) === '.map')) failures.push('consumer build contains source maps');
const distText = (await Promise.all(distFiles.filter((file) => extname(file) !== '.map').map((file) => readFile(file, 'utf8')))).join('\n');
for (const marker of ['/showcase', '参照実装のショーケース', 'Scenarios', 'Evidence status']) if (distText.includes(marker)) failures.push(`consumer build contains audit marker: ${marker}`);

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`UI copy and consumer-boundary audit passed across ${sourceFiles.length} consumer source files and ${distFiles.length} build files.`);
