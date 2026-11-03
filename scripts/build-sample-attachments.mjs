/**
 * 確認用データ（モック）の添付の見本を作る（A14-4）。出力は src/data/samples/ に置き、リポジトリに入れる。
 *
 *   sample-photo.jpg   図形だけの画像（sharp で描く。EXIF なし）
 *   sample-diagram.png 図形だけの画像（同じ）
 *   sample-notice.pdf  日本語の文字を、埋め込まない CID の書体（HeiseiKakuGo-W5、Adobe-Japan1、UniJIS-UCS2-H）で書いた PDF。
 *                      表示する側は CMap を読み、書体を代わりの書体で描く（pdf.js の cMapUrl と標準の書体の確認に使う）
 *   sample-clip.mp4    2秒の H.264 の動画。macOS の AVFoundation で作る（scripts/sample-video.swift）。ほかの環境では作り直さない
 *
 * 実在の人や場所の写真は使わない。これらはモックのビルドだけが読み、dist-http には入らない（audit:security が確かめる）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platform } from 'node:os';
import { join, resolve } from 'node:path';

const sharp = createRequire(import.meta.url)('sharp');
const out = resolve('src/data/samples');
mkdirSync(out, { recursive: true });

const scene = (width, height) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 320 240">
  <rect width="320" height="240" fill="#cfe3d4"/><circle cx="252" cy="62" r="30" fill="#f4d58d"/>
  <path d="M0 196 92 120l70 52 54-34 104 70v32H0z" fill="#4d7c63"/><rect x="36" y="150" width="58" height="46" fill="#f7f2e8"/>
  <path d="M30 152 65 124l35 28z" fill="#b5523b"/><rect x="58" y="172" width="14" height="24" fill="#6b4a3a"/>
</svg>`);

writeFileSync(join(out, 'sample-photo.jpg'), await sharp(scene(320, 240)).jpeg({ quality: 70, mozjpeg: true }).toBuffer());
writeFileSync(join(out, 'sample-diagram.png'), await sharp(scene(160, 120)).png({ palette: true, colors: 16 }).toBuffer());

/** UCS-2（ビッグエンディアン）の16進。UniJIS-UCS2-H の文字の符号。 */
const ucs2 = (text) => [...text].map((character) => character.codePointAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
const lines = ['学校公開のお知らせ（見本）', '受付 9:15〜　来校証を着用してください。', '撮影は教室の外だけでお願いします。'];
const content = ['BT', '/F1 18 Tf', '36 250 Td', `<${ucs2(lines[0])}> Tj`, '/F1 12 Tf', '0 -34 Td', `<${ucs2(lines[1])}> Tj`, '0 -22 Td', `<${ucs2(lines[2])}> Tj`, 'ET'].join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 297] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
  '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [5 0 R] >>',
  '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 5 >> /FontDescriptor 6 0 R /DW 1000 /W [1 95 500 231 632 500] >>',
  '<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -221 /CapHeight 737 /StemV 114 >>',
  `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
];
let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
const offsets = [];
objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
const xref = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(join(out, 'sample-notice.pdf'), Buffer.from(pdf, 'latin1'));

if (platform() === 'darwin') execFileSync('swift', [resolve('scripts/sample-video.swift'), join(out, 'sample-clip.mp4')], { stdio: 'inherit' });
else if (!existsSync(join(out, 'sample-clip.mp4'))) console.warn('sample-clip.mp4 is made on macOS only; keep the committed file');
console.log(`samples written to ${out}`);
