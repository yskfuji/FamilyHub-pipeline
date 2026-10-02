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
          if (!patterns.some((pattern) => pattern.test(candidate))) failures.push(`${file}: unregistered control prefix: ${raw}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Control contract audit passed for ${count} explicit controls and ${patterns.length} inventory families.`);
