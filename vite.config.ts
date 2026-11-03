import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { constants, gzipSync } from 'node:zlib';

/** 実スタックの確認では、配信と同じセキュリティのヘッダーを付ける。localhost の http で動かす分だけ外す。 */
function deliveryHeaders() {
  const lines = readFileSync(resolve(import.meta.dirname, 'public/_headers'), 'utf8').split('\n').filter((line) => line.startsWith('  '));
  const entries = lines.map((line) => { const index = line.indexOf(':'); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; });
  return Object.fromEntries(entries.filter(([name]) => name !== 'Strict-Transport-Security').map(([name, value]) => [name, value.replace('; upgrade-insecure-requests', '')]));
}

/** 配信物の版の印。git が使えないときは未設定の値にして、新しい版の知らせを出さない。 */
function buildId() {
  if (process.env.VITE_BUILD_ID) return process.env.VITE_BUILD_ID;
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim();
  } catch {
    return 'development';
  }
}

/** 版の印を dist-server に残す。画面のビルドと同じ値であることを audit:security が確かめる。 */
function buildIdFile() {
  return {
    name: 'family-hub-build-id',
    apply: (_config: unknown, env: { isSsrBuild?: boolean }) => Boolean(env.isSsrBuild),
    generateBundle(this: { emitFile(file: { type: 'asset'; fileName: string; source: string }): void }) {
      this.emitFile({ type: 'asset', fileName: 'build-id.txt', source: `${buildId()}\n` });
    },
  };
}

/**
 * 配信用に、文字のファイルを前もって gzip（-9）で圧縮して .gz を並べて置く。nginx の gzip_static がそのまま配る（deploy/nginx.conf）。
 * 画面のビルドだけで行い、API の出力先（dist-server）には作らない。書体・画像・動画はすでに圧縮されているので対象にしない。
 * brotli（.br）は作らない。配る側に ngx_brotli が要り、標準の nginx は brotli_static を知らずに起動しないため（deploy/README.md）。
 */
const PRECOMPRESS_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.xml']);
const PRECOMPRESS_MIN_BYTES = 1024;
function precompress() {
  let outDir = '';
  return {
    name: 'family-hub-precompress',
    apply: (_config: unknown, env: { command: string; isSsrBuild?: boolean }) => env.command === 'build' && !env.isSsrBuild,
    configResolved(config: { root: string; build: { outDir: string } }) { outDir = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
      for (const file of walk(outDir)) {
        if (!PRECOMPRESS_EXTENSIONS.has(extname(file))) continue;
        const body = readFileSync(file);
        if (body.length < PRECOMPRESS_MIN_BYTES) continue;
        const packed = gzipSync(body, { level: constants.Z_BEST_COMPRESSION });
        if (packed.length < body.length) writeFileSync(`${file}.gz`, packed);
      }
    },
  };
}

const apiProxy = { '/v1': { target: process.env.FAMILY_HUB_API ?? 'http://127.0.0.1:8799', changeOrigin: false } };

export default defineConfig(({ isSsrBuild }) => {
  const auditSurface = process.env.VITE_INCLUDE_AUDIT_SURFACE === 'true';
  const realStack = process.env.VITE_GATEWAY === 'http';
  return {
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy, ...(realStack ? { headers: deliveryHeaders() } : {}) },
  // public/ は画面の配信物で、API の出力先には入れない。
  ...(isSsrBuild ? { publicDir: false as const } : {}),
  plugins: [react(), buildIdFile(), precompress()],
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId()), __FAMILY_HUB_BUILD__: JSON.stringify(buildId()) },
  resolve: {
    alias: {
      '@audit-surface': resolve(import.meta.dirname, auditSurface ? 'src/app/auditSurface.audit.tsx' : 'src/app/auditSurface.consumer.tsx'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // API と運営者の命令を同じ出力先へ作る。HTTP の経路を持たない命令も、開発用の依存なしで動かせるようにする。
    ...(isSsrBuild ? { rollupOptions: { input: { main: 'server/main.ts', cli: 'server/cli.ts' } } } : {}),
  },
  test: {
    projects: [
      { extends: true as const, test: { name: 'client', environment: 'jsdom', include: ['src/**/*.test.ts'], css: true } },
      { extends: true as const, test: { name: 'server', environment: 'node', include: ['server/**/*.test.ts'], testTimeout: 15_000 } },
    ],
  },
  };
});
