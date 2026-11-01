import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(() => {
  const auditSurface = process.env.VITE_INCLUDE_AUDIT_SURFACE === 'true';
  return {
  plugins: [react()],
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
      { extends: true as const, test: { name: 'client', environment: 'jsdom', include: ['src/**/*.test.ts'] } },
      { extends: true as const, test: { name: 'server', environment: 'node', include: ['server/**/*.test.ts'], testTimeout: 15_000 } },
    ],
  },
  };
});
