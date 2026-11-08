#!/usr/bin/env node
/**
 * iOS の見本のモードの仕組み（src/native/sampleEngine.ts）を、JavaScriptCore で動く1つのファイルにまとめる。
 * Vite だけが読める import（?url の見本の添付）は、iOS が持つ見本のファイルの名前（fh-sample://）に置き換える。
 *
 *   node scripts/ios/build-sample-engine.mjs [--check]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { build } from 'esbuild';
import { writeGenerated } from './generated.mjs';

const resources = 'ios/Packages/FamilyHubKit/Sources/FHGateway/Resources';

const sampleUrls = {
  name: 'sample-urls',
  setup(builder) {
    builder.onResolve({ filter: /\?url/ }, (args) => ({ path: basename(args.path.replace(/\?.*$/, '')), namespace: 'fh-sample' }));
    builder.onLoad({ filter: /.*/, namespace: 'fh-sample' }, (args) => ({ contents: `export default ${JSON.stringify(`fh-sample://${args.path}`)};`, loader: 'js' }));
  },
};

const result = await build({
  entryPoints: ['src/native/sampleEngine.ts'],
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  write: false,
  minify: false,
  legalComments: 'none',
  charset: 'utf8',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_GATEWAY': '"mock"', 'import.meta.env.VITE_INCLUDE_AUDIT_SURFACE': '"false"' },
  plugins: [sampleUrls],
  logLevel: 'warning',
});

const banner = '// 生成したファイル。手で書き換えない。node scripts/ios/build-sample-engine.mjs で作り直す。元: src/native/sampleEngine.ts\n';
writeGenerated(`${resources}/sample-engine.js`, banner + result.outputFiles[0].text);
for (const file of ['sample-photo.jpg', 'sample-diagram.png', 'sample-notice.pdf', 'sample-clip.mp4']) {
  writeGenerated(`${resources}/samples/${file}`, readFileSync(`src/data/samples/${file}`));
}
