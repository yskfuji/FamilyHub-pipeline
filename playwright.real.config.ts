import { defineConfig, devices } from '@playwright/test';
import { rmSync } from 'node:fs';

/** 実際の API と SQLite を使う確認。配信と同じセキュリティのヘッダー（CSP を含む）の下で動かす。 */
const database = 'test-results/real-stack.sqlite';
rmSync(database, { force: true });

export default defineConfig({
  testDir: './e2e/real',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 6_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4174', locale: 'ja-JP', timezoneId: 'Asia/Tokyo', trace: 'retain-on-failure' },
  webServer: [
    { command: 'npx tsx server/dev.ts', env: { FAMILY_HUB_DATABASE: database, FAMILY_HUB_ORIGIN: 'http://localhost:4174', PORT: '8799', FAMILY_HUB_RECENT_AUTH_MS: '2000' }, url: 'http://127.0.0.1:8799/health', reuseExistingServer: false, timeout: 60_000 },
    { command: 'npx vite preview --outDir dist-http --port 4174 --host localhost --strictPort', env: { VITE_GATEWAY: 'http' }, url: 'http://localhost:4174/', reuseExistingServer: false, timeout: 60_000 },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
