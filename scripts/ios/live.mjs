#!/usr/bin/env node
/**
 * iOS アプリを手元のサーバーにつないで確かめる（npm run verify:ios:live）。docs/ios/README.md の「サーバーにつなぐ確認」。
 *   1. 使い捨てのデータベースで開発用のサーバー（server/dev.ts、見本の家族）を 127.0.0.1:8799 で動かす。
 *      本人確認の有効の時間は20秒にする（FAMILY_HUB_RECENT_AUTH_MS）。待たずに「本人確認が要る」場面を作るため。
 *   2. その前に、切り替えのできる中継（127.0.0.1:8798）を置く。試験は /__proxy/offline と /__proxy/online で、
 *      アプリからの通信を切ったり戻したりする（つながらないときの未送信の変更を確かめる）。
 *   3. アプリを FH_DEV_SERVER_URL=http://127.0.0.1:8798 で作り、FamilyHubUITests の LiveServerUITests と
 *      testLiveServerSignInAndOut を流す（TEST_RUNNER_FH_LIVE=1）。
 * 端末は引数で選ぶ（既定は iPhone 17）。例: node scripts/ios/live.mjs "iPad Pro 11"
 * 8787・8000・4310 は使わない。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_PORT = 8799;
const PROXY_PORT = 8798;
// iPad のタブの帯は後ろの項目を隠すので、権限の変更で消えるタブを確かめる試験は iPhone で流す。
const prefix = process.argv[2] ?? 'iPhone 17';

function simulator(name) {
  const list = JSON.parse(spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }).stdout);
  return Object.entries(list.devices)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([runtime, items]) => items.map((item) => ({ ...item, runtime })))
    .filter((item) => item.name.startsWith(name))
    .sort((a, b) => b.runtime.localeCompare(a.runtime, 'en', { numeric: true }) || a.name.localeCompare(b.name))[0];
}

const device = simulator(prefix);
if (!device) { console.error(`${prefix} のシミュレーターがありません。`); process.exit(1); }

spawnSync('xcodegen', ['generate', '--quiet', '--spec', 'ios/project.yml'], { stdio: 'inherit' });
const folder = mkdtempSync(join(tmpdir(), 'fh-live-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'server/dev.ts'], {
  env: { ...process.env, PORT: String(API_PORT), FAMILY_HUB_DATABASE: join(folder, 'live.sqlite'), FAMILY_HUB_MEDIA: join(folder, 'media'), FAMILY_HUB_RECENT_AUTH_MS: '20000' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const stop = () => { server.kill('SIGTERM'); proxy.close(); rmSync(folder, { recursive: true, force: true }); };

// 切り替えのできる中継。切っている間は、アプリからの接続をすぐに閉じる（アプリには「つながらない」に見える）。
let offline = false;
const proxy = createServer((incoming, outgoing) => {
  if (incoming.url === '/__proxy/offline' || incoming.url === '/__proxy/online') {
    offline = incoming.url === '/__proxy/offline';
    outgoing.writeHead(204).end();
    return;
  }
  if (offline) { incoming.socket.destroy(); return; }
  const upstream = request({ host: '127.0.0.1', port: API_PORT, method: incoming.method, path: incoming.url, headers: incoming.headers }, (reply) => {
    outgoing.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(outgoing);
  });
  upstream.on('error', () => incoming.socket.destroy());
  incoming.pipe(upstream);
});

await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => { process.stdout.write(chunk); if (String(chunk).includes('API ')) resolve(); });
  server.on('exit', (code) => reject(new Error(`サーバーが止まりました（${code}）`)));
});
await new Promise((resolve) => proxy.listen(PROXY_PORT, '127.0.0.1', resolve));
console.log(`\n▶ サーバーにつなぐ UI の試験（${device.name}）`);
// 中継は同じ処理の中で動くので、試験の間も応えられるように、xcodebuild は待たずに起こして終わりを待つ。
const status = await new Promise((resolve) => spawn('xcodebuild', [
  '-quiet', '-project', 'ios/FamilyHub.xcodeproj', '-scheme', 'FamilyHub', '-configuration', 'Debug',
  '-destination', `platform=iOS Simulator,id=${device.udid}`, '-derivedDataPath', 'ios/build/live',
  `FH_DEV_SERVER_URL=http://127.0.0.1:${PROXY_PORT}`,
  'test', '-only-testing:FamilyHubUITests/LiveServerUITests', '-only-testing:FamilyHubUITests/FamilyHubUITests/testLiveServerSignInAndOut',
], { stdio: 'inherit', env: { ...process.env, TEST_RUNNER_FH_LIVE: '1' } }).on('exit', resolve));
stop();
if (status !== 0) { console.error('✘ サーバーにつなぐ UI の試験'); process.exit(status ?? 1); }
console.log('サーバーにつなぐ UI の試験は通りました。');
