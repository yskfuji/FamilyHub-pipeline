import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 同梱する頻出パスワードの一覧（src/domain/commonPasswords.json）を作り直す。
 *
 * 出典: SecLists（Daniel Miessler ほか、MIT License）
 *   https://github.com/danielmiessler/SecLists/blob/35d74839e66f44d116e694369d86a5bf07aaed6f/Passwords/Common-Credentials/Pwdb_top-1000000.txt
 *   git blob 99665aeb16c221dfb9a258e39dd58fa37116cfdd、sha256 は下の SOURCE_SHA256。
 *
 * 使い方: node scripts/build-password-list.mjs <ダウンロードした Pwdb_top-1000000.txt>
 *
 * NFKC と小文字にそろえ、15〜64文字の項目だけを、出現の順のまま重複を除いて残す。
 * 15文字より短い項目は最小の長さの検査で必ず拒否され（NIST SP 800-63B-4 3.1.1.2）、64文字を超える項目は入力できないので要らない。
 * メールアドレスの形の項目は、実在する人の連絡先かもしれないので、公開のリポジトリに入れない（自分のメールアドレスの @ より前は、文脈の語として別に拒否する）。
 */
const SOURCE_SHA256 = 'e9a88f67aafe65496682dc374559ee714e978bee50314767494c3e37a18c9fc8';
const MIN = 15;
const MAX = 64;
const EMAIL = /^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const [source] = process.argv.slice(2);
if (!source) { console.error('usage: node scripts/build-password-list.mjs <Pwdb_top-1000000.txt>'); process.exit(1); }
const bytes = readFileSync(source);
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== SOURCE_SHA256) { console.error(`unexpected source: sha256 ${digest}, expected ${SOURCE_SHA256}`); process.exit(1); }

const entries = new Set();
for (const line of bytes.toString('utf8').split(/\r?\n/)) {
  const value = line.normalize('NFKC').toLowerCase();
  if (value.length >= MIN && value.length <= MAX && !EMAIL.test(value)) entries.add(value);
}
const output = `[\n${[...entries].map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`;
const target = resolve(import.meta.dirname, '../src/domain/commonPasswords.json');
writeFileSync(target, output);
console.log(`${entries.size} entries, sha256 ${createHash('sha256').update(output).digest('hex')}`);
