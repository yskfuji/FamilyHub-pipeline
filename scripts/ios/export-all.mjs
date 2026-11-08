#!/usr/bin/env node
/**
 * iOS 向けの生成物をすべて作り直す（--check なら、古いものがないかだけを確かめる）。
 * 順番: 見本の仕組み → 見本の JSON（仕組みを使う）→ 文言 → 計算の答え → テーマ → ブランド → アイコン。
 */
import { spawnSync } from 'node:child_process';

const check = process.argv.includes('--check') ? ['--check'] : [];
const steps = [
  ['node', 'scripts/ios/build-sample-engine.mjs'],
  ['node', 'scripts/ios/export-fixtures.mjs'],
  ['npx', 'tsx', 'scripts/ios/export-copy.ts'],
  ['npx', 'tsx', 'scripts/ios/export-vectors.ts'],
  ['node', 'scripts/ios/export-tokens.mjs'],
  ['node', 'scripts/ios/export-brand.mjs'],
  ['node', 'scripts/ios/export-icon.mjs'],
];
let failed = false;
for (const [command, ...args] of steps) {
  // 見本の JSON は、見本の仕組みを作り直したあとに読む。確かめるときも、仕組みは書かずに今のものを使う。
  const result = spawnSync(command, [...args, ...check], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(check.length ? 'iOS の生成物は最新です。' : 'iOS の生成物を作り直しました。');
