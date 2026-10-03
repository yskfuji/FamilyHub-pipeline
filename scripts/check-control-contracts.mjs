import { readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import ts from 'typescript';

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}

const inventory = JSON.parse(await readFile(resolve('docs/audits/control-inventory.json'), 'utf8'));
const patterns = inventory.contracts.map((contract) => new RegExp(contract.idPattern));
const failures = [];
let count = 0;
const prefixes = [];

// capability は null（公開・本人の操作）か、実在する能力、または「|」で区切った実在する能力の組み合わせ（操作ごとに異なる）だけを許す。
const typesSource = await readFile(resolve('src/domain/types.ts'), 'utf8');
const capabilityUnion = typesSource.match(/export type Capability =([^;]+);/)?.[1] ?? '';
const knownCapabilities = new Set([...capabilityUnion.matchAll(/'([a-z.]+)'/g)].map((match) => match[1]));
for (const contract of inventory.contracts) {
  if (contract.capability === null) continue;
  for (const capability of String(contract.capability).split('|')) {
    if (!knownCapabilities.has(capability)) failures.push(`${contract.idPattern}: unknown capability "${capability}"`);
  }
}

for (const file of (await filesUnder(resolve('src'))).filter((candidate) => extname(candidate) === '.tsx')) {
  const source = await readFile(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(ast);
      if (['button', 'a', 'input', 'select', 'textarea'].includes(tag)) {
        count += 1;
        const attribute = opening.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(ast) === 'data-control-id');
        if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) {
          const { line } = ast.getLineAndCharacterOfPosition(opening.getStart(ast));
          failures.push(`${file}:${line + 1}: data-control-id is missing`);
        } else {
          const raw = attribute.initializer.getText(ast);
          const candidate = raw.startsWith('"') ? raw.slice(1, -1) : raw.match(/`([^$`]*)/)?.[1] ?? '';
          prefixes.push(candidate);
          if (!patterns.some((pattern) => pattern.test(candidate))) failures.push(`${file}: unregistered control prefix: ${raw}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

// 使われていない契約（どの操作にも当たらないパターン）は、台帳と実装のずれとして扱う。
for (const [index, pattern] of patterns.entries()) {
  if (!prefixes.some((prefix) => pattern.test(prefix))) failures.push(`${inventory.contracts[index].idPattern}: no control matches this inventory family`);
}

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Control contract audit passed for ${count} explicit controls and ${patterns.length} inventory families.`);
