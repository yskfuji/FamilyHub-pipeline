import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = await readFile(resolve('docs/data-model.mmd'), 'utf8');
const entities = [...source.matchAll(/^\s{2}([A-Z][A-Za-z]+)\s*\{/gm)].map((match) => match[1]);
const relations = [...source.matchAll(/^\s{2}([A-Z][A-Za-z]+)\s+[^:]+:\s+([a-z_]+)/gm)].map((match) => `${match[1]} · ${match[2]}`);
const columns = 4;
const cardWidth = 230;
const cardHeight = 78;
const gapX = 28;
const gapY = 30;
const width = columns * cardWidth + (columns + 1) * gapX;
const rows = Math.ceil(entities.length / columns);
const height = 130 + rows * (cardHeight + gapY) + 130;
const cards = entities.map((name, index) => {
  const x = gapX + (index % columns) * (cardWidth + gapX);
  const y = 90 + Math.floor(index / columns) * (cardHeight + gapY);
  return `<g><rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="14"/><text x="${x+18}" y="${y+34}" class="entity">${name}</text><text x="${x+18}" y="${y+58}" class="meta">typed entity</text></g>`;
}).join('');
const relationText = relations.slice(0, 12).join('  •  ');
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">Family Hub entity relationship overview</title><desc id="desc">${entities.length} entities. Canonical relationships are in data-model.mmd.</desc>
<style>svg{background:#f6f0e5}rect{fill:#fffdf8;stroke:#b8aa96;stroke-width:1.5}.title{font:700 28px system-ui;fill:#202b33}.subtitle,.meta{font:500 12px system-ui;fill:#68747b}.entity{font:700 16px system-ui;fill:#254e70}.relations{font:500 11px system-ui;fill:#52616a}</style>
<text x="${gapX}" y="42" class="title">Family Hub · Entity Map</text><text x="${gapX}" y="65" class="subtitle">Canonical ER source: docs/data-model.mmd · generated without network access</text>
${cards}
<text x="${gapX}" y="${height-62}" class="subtitle">Selected relationships</text><foreignObject x="${gapX}" y="${height-50}" width="${width-gapX*2}" height="42"><div xmlns="http://www.w3.org/1999/xhtml" style="font:11px system-ui;color:#52616a;line-height:1.5">${relationText}</div></foreignObject>
</svg>`;
await writeFile(resolve('docs/er.svg'), svg);
console.log(`Rendered docs/er.svg with ${entities.length} entities.`);
