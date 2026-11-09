import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { cpSync, createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { constants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { BOOT_COMMON_MODULES, BOOT_ROUTE_MODULES, bootScriptSource, type BootFiles } from './src/app/bootPrefetch.ts';

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

/**
 * PDF の表示（pdf.js、A14-2）が読む CMap と標準の書体を、同じオリジンの /pdfjs/ から配る。
 * 画面のビルドの出力先へ pdfjs-dist から写し（API の出力先には写さない）、開発中は node_modules から配る。
 * CID の書体を使う日本語の PDF は、CMap がないと字を描けない。外のオリジン（CDN）からは読まない（CSP の connect-src 'self'）。
 */
const PDFJS_SOURCE = resolve(import.meta.dirname, 'node_modules/pdfjs-dist');
const PDFJS_RESOURCES = ['cmaps', 'standard_fonts'] as const;
function pdfjsResources() {
  let outDir = '';
  return {
    name: 'family-hub-pdfjs-resources',
    apply: (_config: unknown, env: { isSsrBuild?: boolean }) => !env.isSsrBuild,
    configResolved(config: { root: string; build: { outDir: string } }) { outDir = resolve(config.root, config.build.outDir); },
    configureServer(server: { middlewares: { use(path: string, handler: (request: { url?: string }, response: { setHeader(name: string, value: string): void; end(): void; statusCode: number } & NodeJS.WritableStream, next: () => void) => void): void } }) {
      server.middlewares.use('/pdfjs/', (request, response, next) => {
        const [folder, ...rest] = decodeURIComponent((request.url ?? '').split('?')[0]).replace(/^\/+/, '').split('/');
        const name = rest.join('/');
        if (!(PDFJS_RESOURCES as readonly string[]).includes(folder) || !/^[\w.-]+$/.test(name)) return next();
        const file = join(PDFJS_SOURCE, folder, name);
        if (!existsSync(file)) return next();
        response.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(file).pipe(response);
      });
    },
    writeBundle() {
      for (const folder of PDFJS_RESOURCES) cpSync(join(PDFJS_SOURCE, folder), join(outDir, 'pdfjs', folder), { recursive: true });
    },
  };
}

/**
 * 最初の表示の先読み（src/app/bootPrefetch.ts、docs/audits/lcp-assessment.md）。http のビルドだけで働く。
 * 経路ごとの画面の部品と、それが静的に読むファイルを集めて小さなスクリプトに入れ、index.html の入口より前に置く。
 * 入口がすでに読むファイル（Vite が modulepreload を付けるもの）は入れない。
 */
type BundleChunk = { type: 'chunk'; fileName: string; isEntry: boolean; facadeModuleId: string | null; imports: string[]; viteMetadata?: { importedCss: Set<string> } };
type BundleAsset = { type: 'asset'; fileName: string; source: string | Uint8Array };
function bootPrefetch() {
  let root = '';
  return {
    name: 'family-hub-boot-prefetch',
    apply: (_config: unknown, env: { command: string; isSsrBuild?: boolean }) => env.command === 'build' && !env.isSsrBuild && process.env.VITE_GATEWAY === 'http',
    configResolved(config: { root: string }) { root = config.root; },
    generateBundle: {
      order: 'post' as const,
      handler(this: { emitFile(file: { type: 'asset'; fileName: string; source: string }): void; error(message: string): never }, _options: unknown, bundle: Record<string, BundleChunk | BundleAsset>) {
        const chunks = Object.values(bundle).filter((item): item is BundleChunk => item.type === 'chunk');
        const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
        const closure = (start: string, into = new Set<string>()) => {
          if (into.has(start)) return into;
          into.add(start);
          for (const next of byFile.get(start)?.imports ?? []) closure(next, into);
          return into;
        };
        const html = bundle['index.html'];
        if (!html || html.type !== 'asset') this.error('boot prefetch: no index.html');
        const text = String(html.source);
        // 入口と、Vite が modulepreload を付けたファイル（HTML がすでに読むもの）。
        const inHtml = [...text.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1]);
        if (!inHtml.length) this.error('boot prefetch: no scripts in index.html');
        const loaded = new Set<string>();
        for (const file of inHtml) closure(file, loaded);
        const filesOf = (module: string) => {
          const chunk = chunks.find((item) => item.facadeModuleId === resolve(root, module));
          if (!chunk) this.error(`boot prefetch: no chunk for ${module}`);
          const files = [...closure(chunk.fileName)].filter((file) => !loaded.has(file));
          const css = files.flatMap((file) => [...(byFile.get(file)?.viteMetadata?.importedCss ?? [])]);
          return [...files, ...css];
        };
        const files: BootFiles = { common: BOOT_COMMON_MODULES.flatMap(filesOf), routes: Object.fromEntries(Object.entries(BOOT_ROUTE_MODULES).map(([path, module]) => [path, filesOf(module)])) };
        const source = bootScriptSource(files);
        const fileName = `assets/boot-${createHash('sha256').update(source).digest('hex').slice(0, 10)}.js`;
        this.emitFile({ type: 'asset', fileName, source });
        const at = text.indexOf('<script type="module"');
        if (at < 0) this.error('boot prefetch: no module script in index.html');
        // async にして、HTML の読み取りと最初の描画（index.html の読み込み中の画面）を止めない。
        html.source = `${text.slice(0, at)}<script async src="/${fileName}"></script>\n    ${text.slice(at)}`;
      },
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
  plugins: [react(), buildIdFile(), pdfjsResources(), bootPrefetch(), precompress()],
  // pdf.js の worker は ES モジュール（type: 'module' の worker）として出す。
  worker: { format: 'es' as const },
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId()), __FAMILY_HUB_BUILD__: JSON.stringify(buildId()) },
  resolve: {
    alias: {
      '@audit-surface': resolve(import.meta.dirname, auditSurface ? 'src/app/auditSurface.audit.tsx' : 'src/app/auditSurface.consumer.tsx'),
    },
  },
  build: {
    target: 'es2022',
    // 画面の配信物に入る部品のライセンスの全文を licenses.md として出す（docs/legal/third-party-licenses.md）。
    ...(isSsrBuild ? {} : { license: { fileName: 'licenses.md' } }),
    sourcemap: false,
    // API と運営者の命令を同じ出力先へ作る。HTTP の経路を持たない命令も、開発用の依存なしで動かせるようにする。
    ...(isSsrBuild ? { rollupOptions: { input: { main: 'server/main.ts', cli: 'server/cli.ts' } } } : {
      // 入口が最初に読む部品を1つのファイルにまとめる。細かいファイルが多いと、遅い回線では要求の往復を待つ回数が増える（docs/audits/lcp-assessment.md）。
      rollupOptions: { output: { codeSplitting: { groups: [{ name: 'initial', tags: ['$initial' as const] }] } } },
    }),
  },
  test: {
    projects: [
      { extends: true as const, test: { name: 'client', environment: 'jsdom', include: ['src/**/*.test.ts'], css: true } },
      { extends: true as const, test: { name: 'server', environment: 'node', include: ['server/**/*.test.ts'], testTimeout: 15_000 } },
    ],
  },
  };
});
