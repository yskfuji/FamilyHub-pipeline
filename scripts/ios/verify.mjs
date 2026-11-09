#!/usr/bin/env node
/**
 * iOS アプリの確かめ（npm run verify:ios）。macOS と Xcode がない所では、何もせずに通す。
 *   1. 生成物が最新か（scripts/ios/export-all.mjs --check）
 *   2. xcodegen で project を作る
 *   3. swift test（型・計算・見本の仕組み。macOS で動く）
 *   4. xcodebuild test: アプリを作り、UI の試験（見本のモード、アクセシビリティの監査）を iPhone と iPad のシミュレーターで流す。
 *      サーバーにつなぐ試験（testLiveServerSignInAndOut）は、TEST_RUNNER_FH_LIVE=1 のときだけ動く（docs/ios/README.md）。
 * FAMILY_HUB_SKIP_IOS=1 で飛ばせる。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const skip = (why) => { console.log(`verify:ios を飛ばします（${why}）。`); process.exit(0); };
if (process.env.FAMILY_HUB_SKIP_IOS === '1') skip('FAMILY_HUB_SKIP_IOS=1');
if (process.platform !== 'darwin') skip('macOS ではない');
const has = (command) => spawnSync('which', [command]).status === 0;
if (!has('xcodebuild')) skip('xcodebuild がない');
if (!has('xcodegen')) { console.error('xcodegen がありません（brew install xcodegen）。'); process.exit(1); }

const run = (label, command, args, options = {}) => {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) { console.error(`✘ ${label}`); process.exit(result.status ?? 1); }
};

/** 使えるシミュレーターから、新しい iPhone を1台選ぶ。 */
function simulator(prefix) {
  const list = JSON.parse(spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }).stdout);
  const devices = Object.entries(list.devices)
    .filter(([runtime]) => runtime.includes('iOS'))
    .flatMap(([runtime, items]) => items.map((item) => ({ ...item, runtime })))
    .filter((item) => item.name.startsWith(prefix))
    .sort((a, b) => b.runtime.localeCompare(a.runtime, 'en', { numeric: true }) || a.name.localeCompare(b.name));
  return devices[0];
}

run('生成物が最新か', 'node', ['scripts/ios/export-all.mjs', '--check']);
// Debug のビルドは App/Info-Debug.plist だけを使う。Info.plist の鍵が欠けると、位置の許可などでアプリが止まる。
{
  const keys = (file) => new Set([...readFileSync(file, 'utf8').matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]));
  const debug = keys('ios/App/Info-Debug.plist');
  const missing = [...keys('ios/App/Info.plist')].filter((key) => !debug.has(key));
  if (missing.length) { console.error(`✘ ios/App/Info-Debug.plist に足りない鍵: ${missing.join(', ')}`); process.exit(1); }
}
run('xcodegen', 'xcodegen', ['generate', '--quiet', '--spec', 'ios/project.yml']);
run('swift test', 'swift', ['test', '--package-path', 'ios/Packages/FamilyHubKit']);
const phone = simulator('iPhone 17');
const pad = simulator('iPad Pro 11');
if (!phone) { console.error('iPhone 17 のシミュレーターがありません。'); process.exit(1); }
if (!pad) { console.error('iPad Pro 11-inch のシミュレーターがありません。'); process.exit(1); }
for (const device of [phone, pad]) {
  run(`アプリを作って UI の試験（${device.name}）`, 'xcodebuild', ['-quiet', '-project', 'ios/FamilyHub.xcodeproj', '-scheme', 'FamilyHub', '-configuration', 'Debug', '-destination', `platform=iOS Simulator,id=${device.udid}`, '-derivedDataPath', 'ios/build', 'test']);
}
console.log('\nverify:ios は通りました。');
