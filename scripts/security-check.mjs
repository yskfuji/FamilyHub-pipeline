import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

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
const mediaSrc = fromHeaders('Content-Security-Policy')?.match(/media-src ([^;]+)/)?.[1].trim();
if (mediaSrc !== "'self' blob:") failures.push(`media-src must be exactly 'self' blob: (found: ${mediaSrc})`);
const permissions = fromHeaders('Permissions-Policy') ?? '';
for (const directive of ['geolocation=(self)', 'camera=()', 'microphone=()']) if (!permissions.includes(directive)) failures.push(`Permissions-Policy must include ${directive}`);

// nginx: /v1 は同じオリジンのまま API へ渡す。この中で add_header を書くと上の見出しが消える。
const apiLocation = nginx.match(/location \/v1\/ \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
const defaultPort = (await readFile(resolve('server/main.ts'), 'utf8')).match(/process\.env\.PORT \?\? (\d+)/)?.[1];
for (const required of [`proxy_pass http://127.0.0.1:${defaultPort};`, 'proxy_set_header Host $host;', 'proxy_set_header X-Forwarded-Proto $scheme;', 'proxy_set_header X-Forwarded-For', 'proxy_request_buffering off;']) {
  if (!apiLocation.includes(required)) failures.push(`deploy/nginx.conf location /v1/ must keep ${required}`);
}
if (apiLocation.includes('add_header')) failures.push('deploy/nginx.conf location /v1/ must not use add_header');

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
// 読み取りの補助（LLM）は、確かめた宛先にだけ接続する。宛先は同じ機械か家庭内だけ（外部へは送らない）。
// 接続は http(s).request の1か所で、名前を引き直さない lookup（pinnedLookup）と、使い回しをしない agent: false を必ず渡す。
const llmPath = 'server/adapters/llm.ts';
const llmSource = await readFile(resolve(llmPath), 'utf8');
{
  const ast = ts.createSourceFile(llmPath, llmSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const propertyOf = (literal, name) => literal.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText() === name);
  let requests = 0;
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^(node:)?(tls|net|http2|dgram|dns|dns\/promises)$|^(undici|axios|got|node-fetch)$/.test(node.moduleSpecifier.text)) {
      const named = node.importClause?.namedBindings;
      const onlyIsIp = node.moduleSpecifier.text === 'node:net' && !node.importClause?.name && named && ts.isNamedImports(named) && named.elements.every((item) => item.name.text === 'isIP');
      if (!onlyIsIp) failures.push(`${llmPath}: must not import ${node.moduleSpecifier.text}; connect through http(s).request with the checked lookup`);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && ['fetch', 'connect', 'createConnection'].includes(callee.text)) failures.push(`${llmPath}: ${callee.text}() bypasses the checked lookup`);
      if (ts.isPropertyAccessExpression(callee) && ['fetch', 'connect', 'createConnection'].includes(callee.name.text)) failures.push(`${llmPath}: ${callee.getText()}() bypasses the checked lookup`);
      if (ts.isPropertyAccessExpression(callee) && ['request', 'get'].includes(callee.name.text)) {
        requests += 1;
        const [options] = node.arguments;
        const literal = options && ts.isObjectLiteralExpression(options) ? options : null;
        const lookup = literal && propertyOf(literal, 'lookup');
        const agent = literal && propertyOf(literal, 'agent');
        if (callee.name.text === 'get') failures.push(`${llmPath}: ${callee.getText()}() is not allowed; use request() with the checked lookup`);
        else if (!lookup || !ts.isCallExpression(lookup.initializer) || lookup.initializer.expression.getText() !== 'pinnedLookup') failures.push(`${llmPath}: ${callee.getText()}() must pass lookup: pinnedLookup(...)`);
        else if (!agent || agent.initializer.kind !== ts.SyntaxKind.FalseKeyword) failures.push(`${llmPath}: ${callee.getText()}() must pass agent: false`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (requests !== 1) failures.push(`${llmPath}: must open connections in exactly one http(s).request call (found ${requests})`);
  for (const required of ['resolveChecked(', 'isLocalAddress', 'isLoopbackAddress']) if (!llmSource.includes(required)) failures.push(`${llmPath} must keep ${required}`);
}
// 起動のときに LLM の宛先を確かめる。名前が外へ解決するなら起動しない。
for (const file of ['server/main.ts', 'server/dev.ts']) {
  const content = await readFile(resolve(file), 'utf8');
  if (!content.includes('prepareLlmClient(config.llm)') || content.includes('createLlmClient')) failures.push(`${file} must build the reading helper with prepareLlmClient(config.llm)`);
}
// 試験の緩めた設定を、本番の組み立てへ持ち込まない。
for (const file of ['server/main.ts', 'server/dev.ts']) if (/testing:\s*\{|allowHttp|allowAnyPort/.test(await readFile(resolve(file), 'utf8'))) failures.push(`${file} must not relax the URL guard`);

// 構文木で見る検査。server/ の本体（試験と代役を除く）だけが対象。
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/;
const sqlStart = /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP|ALTER|CREATE|PRAGMA)\b/i;
/** Db の中のこれらだけは、利用者の入力を含まない。PRAGMA は値を束縛できない。 */
const dbInternals = new Set(['sql', 'migrations[index]', "commitWhen(value) ? 'COMMIT' : 'ROLLBACK'", '`PRAGMA user_version = ${Number(index + 1)}`']);
const allowedSource = /^src\/(domain|authz|content)\//;
const isDatabase = (expression) => /(^|\.)(db|raw)$/.test(expression.getText());

for (const path of serverFiles) {
  const content = await readFile(resolve(path), 'utf8');
  const ast = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const checkImport = (specifier) => {
    if (!specifier.startsWith('.')) return;
    const target = relative(resolve('.'), resolve(dirname(path), specifier));
    if (target.startsWith('src/') && !allowedSource.test(`${target}/`)) failures.push(`${path}: may import only src/domain, src/authz and src/content (found ${target})`);
    if (target.startsWith('server/testing') && path !== 'server/dev.ts') failures.push(`${path}: must not import the test doubles (${target})`);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) { if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkImport(node.moduleSpecifier.text); }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) checkImport(node.arguments[0].text);
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && japanese.test(node.text)) {
      failures.push(`${path}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: Japanese text belongs in src/content/serverMessages.ts`);
    }
    if (ts.isTemplateExpression(node) && sqlStart.test(node.head.text) && !(path === 'server/db/db.ts' && dbInternals.has(node.getText()))) failures.push(`${path}: SQL must not be built from a template (${node.head.text.trim().slice(0, 30)})`);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteralLike(node.left) && sqlStart.test(node.left.text)) failures.push(`${path}: SQL must not be built by concatenation`);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['get', 'all', 'run', 'exec', 'prepare'].includes(node.expression.name.text) && isDatabase(node.expression.expression)) {
      const [first] = node.arguments;
      const literal = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first));
      if (!literal && !(path === 'server/db/db.ts' && first && dbInternals.has(first.getText()))) failures.push(`${path}: database calls take a literal statement (found ${first?.getText().slice(0, 40)})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  // Cookie を書くのはセッションの部品だけ。
  if (path !== 'server/auth/sessions.ts' && /set-cookie|setCookie|clearCookie/i.test(content)) failures.push(`${path}: Set-Cookie belongs in server/auth/sessions.ts`);
}

// パスワードのハッシュは @node-rs/argon2 だけで行う。Node の crypto.argon2 / argon2Sync は、試験を含めて server/ と src/ のどこでも使わない（A10-4）。
{
  const everyFile = [...(await filesUnder(resolve('server'))), ...(await filesUnder(resolve('src')))].filter((file) => /\.(ts|tsx|mts|js|mjs)$/.test(file));
  const banned = new Set(['argon2', 'argon2Sync']);
  for (const file of everyFile) {
    const path = relative(resolve('.'), file);
    const content = await readFile(file, 'utf8');
    if (!/argon2/.test(content)) continue;
    const ast = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const report = (node, what) => failures.push(`${path}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${what} from node:crypto is prohibited; hash passwords through server/auth/password.ts (@node-rs/argon2)`);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^(node:)?crypto$/.test(node.moduleSpecifier.text)) {
        const named = node.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) for (const element of named.elements) if (banned.has((element.propertyName ?? element.name).text)) report(element, element.getText());
      }
      if (ts.isPropertyAccessExpression(node) && banned.has(node.name.text)) report(node, node.getText());
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && banned.has(node.argumentExpression.text)) report(node, node.getText());
      if (ts.isBindingElement(node) && banned.has((node.propertyName && ts.isIdentifier(node.propertyName) ? node.propertyName : ts.isIdentifier(node.name) ? node.name : { text: '' }).text)) report(node, node.getText());
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
}

// ビルドの中身。代役と確認用データが配信物へ混ざらないこと、画面と API の版の印がそろうこと。
async function builtText(dir) {
  const files = (await filesUnder(resolve(dir))).filter((file) => ['.js', '.html', '.css'].includes(extname(file)));
  return (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
}
if (!existsSync(resolve('dist-server/main.js')) || !existsSync(resolve('dist-server/cli.js')) || !existsSync(resolve('dist-http'))) {
  failures.push('dist-server (with main.js and cli.js) and dist-http are required: run npm run build:server and npm run build:http first');
} else {
  const server = await builtText('dist-server');
  const http = await builtText('dist-http');
  for (const marker of ['fakeClamd', 'fakeLlm', 'seedHousehold', 'SEED_PASSWORD', 'server/testing', 'test-double', '森さんち', 'member-aoi']) if (server.includes(marker)) failures.push(`dist-server contains a test double or fixture marker: ${marker}`);
  for (const marker of ['森さんち', 'member-aoi', 'runtime.mock']) if (http.includes(marker)) failures.push(`dist-http contains a fixture marker: ${marker}`);
  // 頻出のパスワードの一覧は、最初の表示で読むファイル（入口と先読み）に入れず、別のファイルとして配る（A9-4）。
  const indexHtml = await readFile(resolve('dist-http/index.html'), 'utf8');
  const firstView = [...indexHtml.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  const listMarker = 'manchesterunited';
  for (const asset of firstView) if ((await readFile(resolve('dist-http', asset), 'utf8')).includes(listMarker)) failures.push(`dist-http/${asset} is loaded with the first view but contains the common-password list`);
  if (!firstView.length || !http.includes(listMarker)) failures.push('dist-http must ship the common-password list as a separate file');
  const buildId = (await readFile(resolve('dist-server/build-id.txt'), 'utf8')).trim();
  if (!buildId) failures.push('dist-server/build-id.txt is empty');
  if (!server.includes(buildId)) failures.push(`dist-server does not embed its build id ${buildId}`);
  if (!http.includes(buildId)) failures.push(`dist-http and dist-server carry different build ids (server: ${buildId}): build them from the same commit`);
}

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Security static checks passed across ${sourceFiles.length} source files and ${serverFiles.length} server files (headers in sync; one place-lookup egress; outbound calls only in server/adapters; the LLM connects only through the checked lookup; literal SQL; cookies in one module; server imports limited; no Japanese literals in server; builds free of test doubles and fixtures; matching build ids).`);
