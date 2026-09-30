import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
const sourceFiles = (await filesUnder(resolve('src'))).filter((file) => /\.(ts|tsx)$/.test(file));
const text = (await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const failures = [];
if (/dangerouslySetInnerHTML/.test(text)) failures.push('dangerouslySetInnerHTML is prohibited');
if (/(localStorage|sessionStorage)\.setItem\([^,]*(token|session|password|credential)/i.test(text)) failures.push('authentication material stored in Web Storage');
if (!text.includes("credentials: 'include'")) failures.push('HTTP adapter must opt into server cookie credentials');
const headers = await readFile(resolve('public/_headers'), 'utf8');
for (const directive of ["frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", 'Strict-Transport-Security']) {
  if (!headers.includes(directive)) failures.push(`missing security header directive: ${directive}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Security static checks passed across ${sourceFiles.length} source files.`);
