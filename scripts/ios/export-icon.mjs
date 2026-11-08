#!/usr/bin/env node
/**
 * iOS のアプリのアイコンを、Web の柿の印（src/design-system/components.tsx の BrandMark）と、
 * 標準の昼の地の色（--paper）から作る。1024×1024 の PNG を1枚（iOS 26 は1枚から各大きさを作る）。
 *
 *   node scripts/ios/export-icon.mjs [--check]
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { writeGenerated } from './generated.mjs';

const tokens = readFileSync('src/design-system/tokens.css', 'utf8');
const value = (name) => tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))[1];
const brandSvg = readFileSync('src/design-system/components.tsx', 'utf8').match(/<svg className="brand-mark"[\s\S]*?<\/svg>/)[0];
const paths = [...brandSvg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);

// 印を中央に、四隅の丸め（iOS が行う）に掛からない大きさで置く。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="${value('--paper')}"/>
  <g transform="translate(9.6 9.6) scale(0.6)">
    <path d="${paths[0]}" fill="${value('--kaki-soft')}" stroke="${value('--kaki')}" stroke-width="2"/>
    <path d="${paths[1]}" fill="none" stroke="${value('--kaki-stem')}" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`;

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
const base = 'ios/App/Assets.xcassets';
writeGenerated(`${base}/AppIcon.appiconset/icon-1024.png`, png);
writeGenerated(`${base}/AppIcon.appiconset/Contents.json`, `${JSON.stringify({ images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2)}\n`);
writeGenerated(`${base}/Contents.json`, `${JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2)}\n`);
