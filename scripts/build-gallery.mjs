import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve('artifacts/screens');
const files = (await readdir(dir)).filter((file) => file.endsWith('.png')).sort();
const cards = files.map((file) => `<figure><a href="./${file}"><img src="./${file}" alt="${file}" loading="lazy"></a><figcaption>${file.replaceAll('-', ' ').replace('.png','')}</figcaption></figure>`).join('\n');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Family Hub Screens</title><style>body{margin:0;padding:32px;background:#eee5d8;color:#24313a;font-family:system-ui,sans-serif}h1{font-family:serif}.note{max-width:70ch}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px}figure{margin:0;padding:12px;background:#fff;border:1px solid #cabda9;border-radius:16px}img{display:block;width:100%;height:auto;border-radius:9px;border:1px solid #ddd}figcaption{padding:10px 4px 2px;font-size:13px;font-weight:700;overflow-wrap:anywhere}</style></head><body><h1>よりどころ · Screen Gallery</h1><p class="note">ja-JP / Asia/Tokyo / 固定シード。画像は自動撮影後に人手で原寸確認します。実利用者評価は evidence-pending です。</p><div class="grid">${cards}</div></body></html>`;
await writeFile(resolve(dir, 'gallery.html'), html);
console.log(`Built gallery with ${files.length} screenshots.`);
