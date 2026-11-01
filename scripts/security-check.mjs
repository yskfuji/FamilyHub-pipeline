import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
const sourceFiles = (await filesUnder(resolve('src'))).filter((file) => /\.(ts|tsx)$/.test(file));
const sources = await Promise.all(sourceFiles.map(async (file) => ({ path: relative(resolve('.'), file), text: await readFile(file, 'utf8') })));
const production = sources.filter((file) => !/\.(test|fixtures)\.ts$/.test(file.path));
const text = sources.map((file) => file.text).join('\n');
const failures = [];
if (/dangerouslySetInnerHTML/.test(text)) failures.push('dangerouslySetInnerHTML is prohibited');
if (/(localStorage|sessionStorage)\.setItem\([^,]*(token|session|password|credential)/i.test(text)) failures.push('authentication material stored in Web Storage');
if (!text.includes("credentials: 'include'")) failures.push('HTTP adapter must opt into server cookie credentials');

// 配信ヘッダー: 静的ホスティング用と nginx 用で、同じ方針を同じ値で配る。
const headers = await readFile(resolve('public/_headers'), 'utf8');
for (const directive of ["frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", 'Strict-Transport-Security']) {
  if (!headers.includes(directive)) failures.push(`missing security header directive: ${directive}`);
}
const nginx = await readFile(resolve('deploy/nginx.conf'), 'utf8');
const fromHeaders = (name) => headers.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm'))?.[1].trim();
const fromNginx = (name) => nginx.match(new RegExp(`add_header ${name} "([^"]+)" always;`))?.[1].trim();
for (const name of ['Content-Security-Policy', 'Permissions-Policy', 'Strict-Transport-Security', 'Referrer-Policy', 'X-Content-Type-Options', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy']) {
  const a = fromHeaders(name); const b = fromNginx(name);
  if (!a || !b) failures.push(`header ${name} must be present in public/_headers and deploy/nginx.conf`);
  else if (a !== b) failures.push(`header ${name} differs between public/_headers and deploy/nginx.conf`);
}
const connectSrc = fromHeaders('Content-Security-Policy')?.match(/connect-src ([^;]+)/)?.[1].trim();
if (connectSrc !== "'self' https://api.openpoiapi.com") failures.push(`connect-src must be exactly 'self' https://api.openpoiapi.com (found: ${connectSrc})`);
const permissions = fromHeaders('Permissions-Policy') ?? '';
for (const directive of ['geolocation=(self)', 'camera=()', 'microphone=()']) if (!permissions.includes(directive)) failures.push(`Permissions-Policy must include ${directive}`);

// 外部の場所検索: 出口は1ファイルだけにし、Cookie・リファラー・キャッシュを使わない。
const egress = production.filter((file) => file.text.includes('api.openpoiapi.com'));
if (egress.length !== 1 || egress[0].path !== 'src/features/place/openPoi.ts') failures.push(`api.openpoiapi.com must appear only in src/features/place/openPoi.ts (found: ${egress.map((file) => file.path).join(', ') || 'none'})`);
const openPoi = sources.find((file) => file.path === 'src/features/place/openPoi.ts')?.text ?? '';
for (const required of ["credentials: 'omit'", "referrerPolicy: 'no-referrer'", "cache: 'no-store'"]) if (!openPoi.includes(required)) failures.push(`openPoi.ts must set ${required}`);

// 位置情報: 一度だけ取得し、継続追跡しない。場所の機能は端末に保存しない。
const geoCallers = production.filter((file) => file.text.includes('getCurrentPosition'));
if (geoCallers.some((file) => file.path !== 'src/features/place/deviceLocation.ts')) failures.push(`getCurrentPosition must be called only from deviceLocation.ts (found: ${geoCallers.map((file) => file.path).join(', ')})`);
if (production.some((file) => file.text.includes('watchPosition'))) failures.push('continuous location tracking (watchPosition) is prohibited');
for (const file of production.filter((item) => item.path.startsWith('src/features/place/'))) {
  if (/localStorage|sessionStorage|indexedDB/.test(file.text)) failures.push(`${file.path} must not persist place data in browser storage`);
}

// 外への接続は server/adapters だけ。代役と試験のほかで、接続の部品を読み込まない。
const serverFiles = (await filesUnder(resolve('server'))).filter((file) => file.endsWith('.ts')).map((file) => relative(resolve('.'), file)).filter((file) => !file.startsWith('server/testing/') && !file.startsWith('server/test/'));
const outbound = /\bfetch\(|\bXMLHttpRequest\b|\bWebSocket\b|from 'node:(http|https|http2|net|tls|dns|dns\/promises|dgram)'|from '(http|https|http2|net|tls|dns|dgram|undici|axios|got)'|require\('(node:)?(http|https|net|tls|dns)'\)/;
for (const file of serverFiles.filter((path) => !path.startsWith('server/adapters/'))) {
  const content = await readFile(resolve(file), 'utf8');
  if (outbound.test(content)) failures.push(`${file}: outbound network calls belong in server/adapters`);
}
// 利用者が指定した URL の取得は、確認を通す1か所だけ。
const pageFetcherSource = await readFile(resolve('server/adapters/urlFetcher.ts'), 'utf8');
for (const required of ['pinnedLookup', 'isForbiddenAddress', 'agent: false', "'Accept-Encoding': 'identity'"]) if (!pageFetcherSource.includes(required)) failures.push(`server/adapters/urlFetcher.ts must keep ${required}`);
// 試験の緩めた設定を、本番の組み立てへ持ち込まない。
for (const file of ['server/main.ts', 'server/dev.ts']) if (/testing:\s*\{|allowHttp|allowAnyPort/.test(await readFile(resolve(file), 'utf8'))) failures.push(`${file} must not relax the URL guard`);

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Security static checks passed across ${sourceFiles.length} source files and ${serverFiles.length} server files (headers in sync; one place-lookup egress; outbound calls only in server/adapters).`);
