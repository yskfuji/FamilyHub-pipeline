#!/usr/bin/env node
/**
 * 手元のサーバーを、同じ Wi-Fi の iPhone・iPad から https で使えるようにする（npm run dev:lan）。docs/ios/README.md の「サーバーにつなぐ」。
 *   - API（server/dev.ts）は 127.0.0.1 のまま動かす。外に出すのは Vite だけで、/v1 を API へ中継する。
 *   - 証明書は mkcert で作り、.certs/ に置く（リポジトリに入れない）。iPhone には mkcert のルート証明書を信頼させる。
 *   - 使わないポート: 8787・8000・4310（ほかの用途で使っている）。
 * アプリには、表示された URL を ios/Config/Local.xcconfig の FH_DEV_SERVER_URL に書く。
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

const AVOID = new Set([8787, 8000, 4310]);
const fail = (message) => { console.error(message); process.exit(1); };

if (spawnSync('which', ['mkcert']).status !== 0) {
  fail([
    'mkcert がありません。次の手順で入れてください（一度だけ）。',
    '  brew install mkcert',
    '  mkcert -install          # この Mac にルート証明書を入れる（パスワードを聞かれる）',
    '  open "$(mkcert -CAROOT)"  # rootCA.pem を AirDrop などで iPhone に送り、',
    '                            # 「設定」→「一般」→「VPNとデバイス管理」で入れ、',
    '                            # 「一般」→「情報」→「証明書信頼設定」で信頼する',
  ].join('\n'));
}

const free = (port) => new Promise((resolve) => {
  const server = createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
  server.listen(port, '0.0.0.0');
});
async function pick(from) {
  for (let port = from; port < from + 50; port += 1) if (!AVOID.has(port) && await free(port)) return port;
  return fail(`空いたポートが ${from} から見つかりません。`);
}

const host = `${execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim()}.local`;
const addresses = Object.values(networkInterfaces()).flat().filter((item) => item && item.family === 'IPv4' && !item.internal).map((item) => item.address);
const certs = '.certs';
const cert = join(certs, 'lan.pem');
const key = join(certs, 'lan-key.pem');
if (!existsSync(cert) || !existsSync(key)) {
  mkdirSync(certs, { recursive: true });
  execFileSync('mkcert', ['-cert-file', cert, '-key-file', key, host, 'localhost', '127.0.0.1', ...addresses], { stdio: 'inherit' });
}

const webPort = await pick(Number(process.env.FAMILY_HUB_LAN_PORT ?? 4330));
const apiPort = await pick(Number(process.env.PORT ?? 8799));
const origin = `https://${host}:${webPort}`;
const children = [
  spawn('npx', ['tsx', 'server/dev.ts'], { stdio: 'inherit', env: { ...process.env, PORT: String(apiPort), FAMILY_HUB_ORIGIN: origin } }),
  spawn('npx', ['vite', '--host', '0.0.0.0', '--port', String(webPort), '--strictPort'], { stdio: 'inherit', env: { ...process.env, VITE_GATEWAY: 'http', FAMILY_HUB_API: `http://127.0.0.1:${apiPort}`, FAMILY_HUB_LAN_CERT: cert, FAMILY_HUB_LAN_KEY: key } }),
];
console.log(`\nLAN の https: ${origin}\n  アプリ: ios/Config/Local.xcconfig に FH_DEV_SERVER_URL = ${origin.replace('://', ':/$()/')} と書いて、npm run ios:device\n  Safari: ${origin}\n`);
const stop = () => { for (const child of children) child.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => { stop(); process.exitCode = code ?? 0; });
