/**
 * iOS 向けに生成したファイルを書く。--check のときは書かずに、今のファイルと違えば止める（npm run verify:ios が使う）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const checking = process.argv.includes('--check');
const stale = [];

export function writeGenerated(path, content) {
  const data = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
  if (checking) {
    if (!existsSync(path) || !readFileSync(path).equals(data)) stale.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || !readFileSync(path).equals(data)) writeFileSync(path, data);
}

process.on('beforeExit', () => {
  if (!stale.length) return;
  console.error(`古い生成ファイル（${process.argv[1]} を流して作り直す）:\n${stale.map((path) => `  ${path}`).join('\n')}`);
  process.exitCode = 1;
});
