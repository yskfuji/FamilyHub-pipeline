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
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
  };
});
