#!/usr/bin/env node
/**
 * Lighthouse を、実際の API（server/dev.ts の見本の家族）と dist-http で、サインインした状態で測る。
 * docs/acceptance/criteria.md の B（性能・Lighthouse）。先に `npm run build:http` を済ませておく。
 *
 *   node scripts/lighthouse-real.mjs [--runs 3] [--forms mobile,desktop] [--screens today,calendar] [--out docs/audits/lighthouse] [--keep dir] [--check]
 *
 * - 画面と形（mobile・desktop）ごとに runs 回測り、中央値（LCP の中央値の回）を記録する。
 * - --keep を付けると、完全な Lighthouse の JSON をその場所に残す（LCP の要素や通信の連なりを調べるとき）。
 * - --check を付けると、基準に届かない組があれば終了コード 1 を返す。
 * 試験用のポート（8799・4174）とは別のポートを使うので、test:real と同時に動かさない限りぶつからない。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const LIGHTHOUSE = 'lighthouse@12.8.2';
const SCREENS = ['today', 'calendar', 'budget', 'albums', 'notes'];
const TARGETS = { performance: 90, accessibility: 100, bestPractices: 100, lcpMs: 2500, cls: 0.1 };
// 見本の家族のアルバムの写真は、測るときのメディアの置き場所にファイルがない（サムネイルが 502 になり console にエラーが出る）。
const KNOWN_EXCEPTIONS = { albums: { bestPractices: 'seeded album items have no media files in the measurement folder (thumbnail 502)' } };

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const runs = Number(option('runs', '3'));
const forms = option('forms', 'mobile,desktop').split(',');
const screens = option('screens', SCREENS.join(',')).split(',');
const outDir = resolve(option('out', 'docs/audits/lighthouse'));
const keepDir = option('keep', undefined);
const check = args.includes('--check');
const apiPort = Number(process.env.LH_API_PORT ?? 8811);
const webPort = Number(process.env.LH_WEB_PORT ?? 4181);
const origin = `http://localhost:${webPort}`;

if (!existsSync('dist-http/index.html')) { console.error('dist-http がありません。先に npm run build:http を実行してください。'); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), 'family-hub-lh-'));
const children = [];
const start = (command, commandArgs, env, log) => {
  const child = spawn(command, commandArgs, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('exit', () => writeFileSync(join(work, log), output));
  children.push(child);
  return () => output;
};
const stopAll = () => { for (const child of children) child.kill(); };
process.on('exit', () => { stopAll(); rmSync(work, { recursive: true, force: true }); });
process.on('SIGINT', () => process.exit(130));
process.on('uncaughtException', (error) => { console.error(error); process.exit(1); });
process.on('unhandledRejection', (error) => { console.error(error); process.exit(1); });

const waitFor = async (url) => {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* まだ起動していない */ }
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error(`${url} did not start`);
};

const apiOutput = start('npx', ['tsx', 'server/dev.ts'], {
  FAMILY_HUB_DATABASE: join(work, 'lh.sqlite'), FAMILY_HUB_AUDIT_DB: join(work, 'lh.audit.db'), FAMILY_HUB_MEDIA: join(work, 'media'),
  FAMILY_HUB_ORIGIN: origin, PORT: String(apiPort),
}, 'api.log');
start('npx', ['vite', 'preview', '--outDir', 'dist-http', '--port', String(webPort), '--host', 'localhost', '--strictPort'], { VITE_GATEWAY: 'http', FAMILY_HUB_API: `http://127.0.0.1:${apiPort}` }, 'preview.log');
await waitFor(`http://127.0.0.1:${apiPort}/health`);
await waitFor(`${origin}/`);

const password = apiOutput().match(/sign in as \S+ \/ ([^)]+)\)/)?.[1];
if (!password) throw new Error('seed password not found in the API log');
const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const page = await context.newPage();
await page.goto(`${origin}/auth`);
await page.getByRole('button', { name: 'パスワードでサインイン' }).click();
await page.getByLabel('メールアドレス').fill('aoi@example.test');
await page.getByLabel('パスワード', { exact: true }).fill(password);
await page.getByRole('button', { name: 'サインイン', exact: true }).click();
await page.waitForURL(/\/today/);
const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ');
await browser.close();

const lighthouse = (url, form, output) => new Promise((done, fail) => {
  const preset = form === 'desktop' ? ['--preset=desktop'] : [];
  const child = spawn('npx', ['--yes', LIGHTHOUSE, url, '--quiet', ...preset, '--only-categories=performance,accessibility,best-practices',
    `--extra-headers=${JSON.stringify({ Cookie: cookie })}`, '--chrome-flags=--headless=new --no-sandbox --disable-gpu', '--output=json', `--output-path=${output}`], { stdio: 'inherit' });
  child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`lighthouse exited with ${code} for ${url} ${form}`))));
});

const summarize = (report) => {
  const score = (id) => Math.round((report.categories[id]?.score ?? 0) * 100);
  const value = (id) => report.audits[id]?.numericValue;
  const element = report.audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  const phases = report.audits['largest-contentful-paint-element']?.details?.items?.[1]?.items?.map((item) => ({ phase: item.phase, ms: Math.round(item.timing) }));
  const failing = Object.values(report.audits).filter((audit) => audit.scoreDisplayMode === 'binary' && audit.score === 0 ).map((audit) => audit.id);
  return {
    performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'),
    lcpMs: Math.round(value('largest-contentful-paint')), fcpMs: Math.round(value('first-contentful-paint')),
    cls: Number(value('cumulative-layout-shift').toFixed(4)), tbtMs: Math.round(value('total-blocking-time')),
    lcpElement: element?.selector, lcpPhases: phases, failingBinaryAudits: failing,
  };
};

const fetchTime = new Date().toISOString();
const results = [];
mkdirSync(outDir, { recursive: true });
if (keepDir) mkdirSync(keepDir, { recursive: true });
for (const screen of screens) {
  for (const form of forms) {
    const samples = [];
    for (let run = 1; run <= runs; run += 1) {
      const output = join(keepDir ?? work, `${screen}-${form}-${run}.json`);
      await lighthouse(`${origin}/${screen}`, form, output);
      const report = JSON.parse(readFileSync(output, 'utf8'));
      samples.push({ ...summarize(report), throttling: report.configSettings.throttling });
    }
    const sorted = [...samples].sort((a, b) => a.lcpMs - b.lcpMs);
    const median = sorted[Math.floor(sorted.length / 2)];
    const exception = KNOWN_EXCEPTIONS[screen] ?? {};
    const meets = median.performance >= TARGETS.performance && median.accessibility >= TARGETS.accessibility
      && (median.bestPractices >= TARGETS.bestPractices || Boolean(exception.bestPractices)) && median.lcpMs < TARGETS.lcpMs && median.cls < TARGETS.cls;
    const { throttling, ...medianValues } = median;
    const result = { lighthouse: LIGHTHOUSE.split('@')[1], fetchTime, build: 'dist-http, signed in (seeded demo household), vite preview + server/dev.ts on this machine', throttling, screen, path: `/${screen}`, formFactor: form, runs, ...medianValues, lcpMsRuns: samples.map((sample) => sample.lcpMs), exceptions: exception, meetsTargets: meets };
    writeFileSync(join(outDir, `${screen}-${form}.json`), `${JSON.stringify(result, null, 2)}\n`);
    results.push(result);
    console.log(`${screen} ${form}: LCP ${median.lcpMs}ms (runs ${result.lcpMsRuns.join('/')}) FCP ${median.fcpMs}ms perf ${median.performance} a11y ${median.accessibility} bp ${median.bestPractices} CLS ${median.cls} ${meets ? 'ok' : 'MISS'}`);
  }
}
const summary = { lighthouse: LIGHTHOUSE.split('@')[1], measuredOn: fetchTime.slice(0, 10), runsPerScreen: runs, statistic: 'median by LCP', targets: { performance: `>=${TARGETS.performance}`, accessibility: TARGETS.accessibility, bestPractices: TARGETS.bestPractices, lcpMs: `<${TARGETS.lcpMs}`, cls: `<${TARGETS.cls}` }, note: 'INP needs field data; TBT is the lab proxy.', knownExceptions: KNOWN_EXCEPTIONS, results: results.map((result) => Object.fromEntries(Object.entries(result).filter(([key]) => !['lighthouse', 'fetchTime', 'build', 'throttling'].includes(key)))) };
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
// 起動した API とプレビューを止めて終わる（止めないと子の出力を待ち続けて終わらない）。
process.exit(check && results.some((result) => !result.meetsTargets) ? 1 : 0);
