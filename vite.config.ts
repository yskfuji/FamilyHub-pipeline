import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const apiProxy = { '/v1': { target: process.env.FAMILY_HUB_API ?? 'http://127.0.0.1:8799', changeOrigin: false } };

export default defineConfig(() => {
  const auditSurface = process.env.VITE_INCLUDE_AUDIT_SURFACE === 'true';
  const realStack = process.env.VITE_GATEWAY === 'http';
  return {
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy, ...(realStack ? { headers: deliveryHeaders() } : {}) },
  plugins: [react()],
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId()) },
  resolve: {
    alias: {
      '@audit-surface': resolve(import.meta.dirname, auditSurface ? 'src/app/auditSurface.audit.tsx' : 'src/app/auditSurface.consumer.tsx'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    projects: [
      { extends: true as const, test: { name: 'client', environment: 'jsdom', include: ['src/**/*.test.ts'], css: true } },
      { extends: true as const, test: { name: 'server', environment: 'node', include: ['server/**/*.test.ts'], testTimeout: 15_000 } },
    ],
  },
  };
});
