import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve('artifacts/screens');
const files = (await readdir(dir)).filter((file) => file.endsWith('.png')).sort();
const words = new Map([
  ['today', '今日'], ['calendar', '予定'], ['tasks', 'タスク'], ['notes', 'メモ'], ['budget', '家計'], ['insights', 'ヒント'], ['settings', '設定'], ['welcome', 'はじめに'], ['auth', 'サインイン'], ['onboarding', '初期設定'], ['showcase', '内部監査'], ['mobile', 'スマートフォン'], ['tablet', 'タブレット'], ['desktop', 'パソコン'], ['light', '明るい配色'], ['dusk', '夕景の配色'], ['empty', 'データなし'], ['offline', 'オフライン'], ['conflict', '変更の競合'], ['weather', '荒天'], ['owner', '管理者'], ['adult', '大人のメンバー'], ['child', '子どもメンバー'], ['guest', 'ゲスト'], ['household', '家族'], ['notification', '通知'], ['notifications', '通知'], ['center', '一覧'], ['edit', '編集'], ['permission', '権限'], ['password', 'パスワード'], ['resources', '関連リンク'], ['security', 'サインインとセキュリティ'], ['accessibility', '表示と操作'], ['forbidden', '表示不可'], ['quarantined', '添付確認中'],
]);
const phrases = new Map([['expired-invite', '招待の期限切れ'], ['expired-session', 'サインインの期限切れ'], ['notification-center', '通知一覧']]);
const caption = (file) => {
  let name = file.replace('.png', '');
  for (const [phrase, label] of phrases) name = name.replaceAll(phrase, label);
  const result = name.split('-').map((word) => words.get(word) ?? (/^\d+$/.test(word) ? `${word}px` : word)).join('・');
  if (/[A-Za-z]/.test(result)) throw new Error(`日本語化されていない画像名があります: ${file}`);
  return result;
};
const cards = files.map((file) => `<figure><a href="./${file}"><img src="./${file}" alt="${caption(file)}の画面" loading="lazy"></a><figcaption>${caption(file)}</figcaption></figure>`).join('\n');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>よりどころ・画面ギャラリー</title><style>body{margin:0;padding:32px;background:#eee5d8;color:#24313a;font-family:system-ui,sans-serif}h1{font-family:serif}.note{max-width:70ch}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px}figure{margin:0;padding:12px;background:#fff;border:1px solid #cabda9;border-radius:16px}img{display:block;width:100%;height:auto;border-radius:9px;border:1px solid #ddd}figcaption{padding:10px 4px 2px;font-size:13px;font-weight:700;overflow-wrap:anywhere}</style></head><body><h1>よりどころ・画面ギャラリー</h1><p class="note">日本語・日本時間・固定の確認用データで撮影しています。画像は自動撮影後に人の目でも原寸確認します。実際の家庭での使いやすさは、利用者による評価がまだ必要です。</p><div class="grid">${cards}</div></body></html>`;
await writeFile(resolve(dir, 'gallery.html'), html);
console.log(`${files.length}枚の画像でギャラリーを作成しました。`);
