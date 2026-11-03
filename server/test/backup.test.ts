import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Keyring } from '../auth/keyring';
import { BackupBusyError, createGeneration, databaseProblem, listGenerations, manifestPath, mediaReferences, readManifest } from '../backup/backup';
import type { BackupSettings, BackupSources } from '../backup/backup';
import { generationsToKeep, localTime } from '../backup/calendar';
import { runBackupCommand } from '../backup/command';
import { BackupKeys } from '../backup/format';
import { FileLock, maintenanceLock, serverLockPath } from '../backup/lock';
import { createBackupScheduler } from '../backup/schedule';
import { loadBackup } from '../config';
import type { ServerConfig } from '../config';
import { runRetention } from '../jobs';
import { createWorld } from '../testing/world';
import type { World } from '../testing/world';

const KEY = 'backup-key-for-tests-only-0123456789abcdef';
const CHUNK = 64 * 1024;
const roots: string[] = [];
const worlds: World[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const tempRoot = () => { const root = mkdtempSync(join(tmpdir(), 'family-hub-backup-test-')); roots.push(root); return root; };

/** 見本のファイル。写真は JPEG の先頭（SOI・JFIF・Exif の印）を持ち、添付は PDF の先頭を持つ。中身は決まった疑似乱数。 */
function sampleBytes(seed: string, size: number, kind: 'jpeg' | 'pdf') {
  const head = kind === 'jpeg' ? Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.from([0xff, 0xe1]), Buffer.from('Exif\0\0')]) : Buffer.from('%PDF-1.4\n');
  const body = Buffer.alloc(size - head.length);
  let block = createHash('sha256').update(seed).digest();
  for (let offset = 0; offset < body.length; offset += 32) { block = createHash('sha256').update(block).digest(); block.copy(body, offset); }
  return Buffer.concat([head, body]);
}

const BIG = 'media/house-mori/item-sports-1/original';

interface Household {
  root: string; world: World; media: string; files: Map<string, Buffer>; settings: BackupSettings; sources: BackupSources; config: ServerConfig; databasePath: string; auditPath: string;
  cli(args: string[], keys?: Keyring): Promise<{ code: number; out: string; err: string }>;
}

/** ファイルの DB と audit.db を持つ家族。写した DB が参照するメディアのファイルを、置き場所に実際に置く。 */
async function household(options: { keys?: Keyring } = {}): Promise<Household> {
  const root = tempRoot();
  const media = join(root, 'media');
  const databasePath = join(root, 'data', 'family-hub.sqlite');
  const auditPath = join(root, 'data', 'audit.db');
  const world = createWorld('member-aoi', undefined, undefined, {}, { databasePath, auditDatabasePath: auditPath, mediaPath: media, keys: options.keys });
  worlds.push(world);
  await world.ready;
  const files = new Map<string, Buffer>();
  for (const path of mediaReferences(world.deps.db)) {
    const bytes = sampleBytes(path, path === BIG ? CHUNK * 3 + 123 : 5000 + files.size * 77, path.includes('attachment') ? 'pdf' : 'jpeg');
    const absolute = join(media, path.slice('media/'.length));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    files.set(path, bytes);
  }
  const settings: BackupSettings = { dir: join(root, 'backup'), key: KEY, timeZone: 'Asia/Tokyo', chunkSize: CHUNK };
  const sources: BackupSources = { db: world.deps.db, audit: world.deps.audit, mediaPath: media };
  const config: ServerConfig = { ...world.deps.config, databasePath, auditDatabasePath: auditPath, mediaPath: media, backup: { dir: settings.dir, key: KEY, at: { hour: 3, minute: 0 }, timeZone: 'Asia/Tokyo' } };
  const cli = async (args: string[], keys?: Keyring) => {
    const out: string[] = []; const err: string[] = [];
    const code = await runBackupCommand(args, { config: keys ? { ...config, keys } : config, out: (line) => out.push(line), err: (line) => err.push(line), openSources: () => ({ db: world.deps.db, audit: world.deps.audit, close: () => undefined }) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  return { root, world, media, files, settings, sources, config, databasePath, auditPath, cli };
}

function allFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? allFiles(join(dir, entry.name)) : [join(dir, entry.name)]));
}

async function chunksOf(settings: BackupSettings, id: string, path: string) {
  const manifest = await readManifest(settings, id);
  const file = manifest.files.find((item) => item.path === path)!;
  const keys = new BackupKeys(KEY);
  return Array.from({ length: file.chunks }, (_, index) => { const name = keys.chunkName(file.blob, index, index === file.chunks - 1); return join(settings.dir, 'chunks', name.slice(0, 2), name); });
}

describe('creating a generation (A8-1, A8-2, A8-3, A8-6)', () => {
  it('snapshots both databases and every referenced media file, verifies it, and writes nothing in plaintext', async () => {
    const h = await household();
    const result = await createGeneration(h.settings, h.sources);
    expect(await listGenerations(h.settings.dir)).toEqual([result.id]);
    const manifest = await readManifest(h.settings, result.id);
    expect(manifest.files.map((file) => file.path).sort()).toEqual(['audit.db', 'family-hub.sqlite', ...h.files.keys()].sort());
    expect(manifest.files.find((file) => file.path === BIG)?.chunks).toBe(4);
    expect(manifest.audit).toEqual(h.world.deps.audit.currentAnchor());
    for (const [path, bytes] of h.files) expect(manifest.files.find((file) => file.path === path)?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await h.cli(['backup', 'verify', result.id])).toMatchObject({ code: 0 });

    const stored = allFiles(h.settings.dir);
    expect(stored.length).toBeGreaterThan(h.files.size);
    const plaintextHashes = [...h.files.values()].map((bytes) => createHash('sha256').update(bytes).digest('hex'));
    for (const file of stored) {
      const bytes = readFileSync(file);
      // 印は偶然に一致しない長さで調べる（3バイトの FF D8 FF は、乱数の暗号文にも出ることがある）。
      for (const marker of [Buffer.from('SQLite format 3\0'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.from('Exif\0\0'), Buffer.from('%PDF-1.4')]) expect(bytes.includes(marker), `${file} contains ${marker.toString('hex')}`).toBe(false);
      // 名前にも中身にも、平文の sha256 は出ない（よく知られたファイルがあるかを鍵なしで確かめられない）。
      for (const hash of plaintextHashes) { expect(file).not.toContain(hash); expect(bytes.includes(Buffer.from(hash))).toBe(false); }
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(statSync(join(h.settings.dir, 'generations')).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(h.settings.dir, 'tmp'))).toEqual([]);
  });

  it('shares unchanged chunks across generations', async () => {
    const h = await household();
    const first = await createGeneration(h.settings, h.sources, { now: new Date('2026-11-02T03:00:00+09:00') });
    const second = await createGeneration(h.settings, h.sources, { now: new Date('2026-11-03T03:00:00+09:00') });
    expect(first.writtenChunks).toBeGreaterThan(h.files.size);
    // メディアは前の世代の塊をそのまま使う。書くのは変わった DB の分だけ。
    expect(second.writtenChunks).toBeLessThanOrEqual(2);
    expect(await chunksOf(h.settings, second.id, BIG)).toEqual(await chunksOf(h.settings, first.id, BIG));
  });

  it('stops without a generation when a referenced media file is missing', async () => {
    const h = await household();
    rmSync(join(h.media, 'house-mori', 'item-park-1', 'original'));
    await expect(createGeneration(h.settings, h.sources)).rejects.toThrow('media/house-mori/item-park-1/original is referenced but missing');
    expect(await h.cli(['backup', 'now'])).toMatchObject({ code: 2, err: expect.stringContaining('item-park-1/original') });
    expect(await listGenerations(h.settings.dir)).toEqual([]);
  });
});

describe('checking the copies (A8-1)', () => {
  it('stops without a generation when the copy fails foreign_key_check, and reports a damaged file', async () => {
    const h = await household();
    // integrity_check は外部キーを見ないので、foreign_key_check も行う。
    const raw = new DatabaseSync(h.databasePath);
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare("INSERT INTO recovery_codes (user_id, code_hash, used_at) VALUES ('user-nobody', 'hash', NULL)").run();
    raw.close();
    await expect(createGeneration(h.settings, h.sources)).rejects.toThrow('the copy of family-hub.sqlite failed the check (foreign_key_check: 1 row(s), first in recovery_codes)');
    expect(await listGenerations(h.settings.dir)).toEqual([]);

    const damaged = join(h.root, 'damaged.sqlite');
    const db = new DatabaseSync(damaged);
    db.exec("PRAGMA page_size = 1024; CREATE TABLE t (x TEXT); CREATE INDEX t_x ON t(x);");
    for (let index = 0; index < 400; index += 1) db.prepare('INSERT INTO t VALUES (?)').run(`row-${index}-${'x'.repeat(40)}`);
    db.close();
    expect(databaseProblem(damaged)).toBeNull();
    const bytes = readFileSync(damaged);
    for (let offset = bytes.length - 3 * 1024 + 100; offset < bytes.length - 2 * 1024; offset += 1) bytes[offset] = 0x55;
    writeFileSync(damaged, bytes);
    expect(databaseProblem(damaged)).toMatch(/^integrity_check: /);
  });
});

describe('interruption (A8-7)', () => {
  it('leaves no visible generation when a run fails at any stage before the manifest is renamed', async () => {
    const h = await household();
    for (const stop of ['snapshot', 'chunks', 'manifest', 'verify', 'commit'] as const) {
      await expect(createGeneration(h.settings, h.sources, { stage: (stage) => { if (stage === stop) throw new Error(`stopped at ${stop}`); } })).rejects.toThrow(`stopped at ${stop}`);
      expect(await listGenerations(h.settings.dir)).toEqual([]);
      expect(await h.cli(['backup', 'list'])).toEqual({ code: 0, out: '', err: '' });
      expect(existsSync(join(h.media, '.maintenance.lock'))).toBe(false);
    }
    // 確定した後（古い世代の片付けの前）で止まっても、確定した世代は全部そろっている。
    await expect(createGeneration(h.settings, h.sources, { stage: (stage) => { if (stage === 'prune') throw new Error('stopped at prune'); } })).rejects.toThrow('stopped at prune');
    const [committed] = await listGenerations(h.settings.dir);
    expect(await h.cli(['backup', 'verify', committed])).toMatchObject({ code: 0 });
  });

  it('leaves no visible generation when the process is killed (SIGKILL), and the next run takes over the lock and tidies up', async () => {
    const h = await household();
    for (const stop of ['chunks', 'verify', 'commit']) {
      const outcome = await new Promise<string>((done) => {
        spawn(process.execPath, ['--import', 'tsx', resolve(import.meta.dirname, '../testing/backupInterrupted.ts'), h.databasePath, h.auditPath, h.media, h.settings.dir, stop], { env: { ...process.env, FAMILY_HUB_BACKUP_KEY: KEY }, stdio: 'ignore' }).on('exit', (code, signal) => done(signal ?? String(code)));
      });
      expect(outcome).toBe('SIGKILL');
      expect(await listGenerations(h.settings.dir)).toEqual([]);
    }
    // 止まった処理のロックと一時ファイルが残っている。
    expect(existsSync(join(h.media, '.maintenance.lock'))).toBe(true);
    expect(readdirSync(join(h.settings.dir, 'tmp')).length).toBeGreaterThan(0);
    const result = await createGeneration(h.settings, h.sources);
    expect(await listGenerations(h.settings.dir)).toEqual([result.id]);
    expect(readdirSync(join(h.settings.dir, 'tmp'))).toEqual([]);
    expect(existsSync(join(h.media, '.maintenance.lock'))).toBe(false);
  }, 60_000);
});

describe('verify detects changes to the stored files (A8-7)', () => {
  it('exits 2 after a 1-byte change, a swap, a reorder or a truncation, and 0 once the bytes are put back', async () => {
    const h = await household();
    const { id } = await createGeneration(h.settings, h.sources);
    const big = await chunksOf(h.settings, id, BIG);
    const other = await chunksOf(h.settings, id, 'media/house-mori/item-park-1/original');
    const manifest = manifestPath(h.settings.dir, id);
    const faults: Array<{ name: string; files: string[]; apply(): void; expect: string }> = [
      { name: 'one byte of a chunk', files: [big[1]], apply: () => { const bytes = readFileSync(big[1]); bytes[bytes.length - 40] ^= 1; writeFileSync(big[1], bytes); }, expect: 'chunk 1 of media/house-mori/item-sports-1/original does not authenticate' },
      { name: 'one byte of the manifest', files: [manifest], apply: () => { const bytes = readFileSync(manifest); bytes[40] ^= 1; writeFileSync(manifest, bytes); }, expect: 'manifest does not authenticate' },
      { name: 'swapping two chunks', files: [big[0], big[1]], apply: () => { const [a, b] = [readFileSync(big[0]), readFileSync(big[1])]; writeFileSync(big[0], b); writeFileSync(big[1], a); }, expect: 'chunk 0 of media/house-mori/item-sports-1/original does not authenticate' },
      { name: 'reordering three chunks', files: big.slice(0, 3), apply: () => { const parts = big.slice(0, 3).map((file) => readFileSync(file)); writeFileSync(big[0], parts[1]); writeFileSync(big[1], parts[2]); writeFileSync(big[2], parts[0]); }, expect: 'chunk 0 of media/house-mori/item-sports-1/original does not authenticate' },
      { name: 'a chunk from another file', files: [big[3]], apply: () => { writeFileSync(big[3], readFileSync(other[0])); }, expect: 'chunk 3 of media/house-mori/item-sports-1/original does not authenticate' },
      { name: 'truncating the last chunk', files: [big[3]], apply: () => { writeFileSync(big[3], readFileSync(big[3]).subarray(0, 60)); }, expect: 'chunk 3 of media/house-mori/item-sports-1/original does not authenticate' },
      { name: 'removing the last chunk', files: [big[3]], apply: () => { rmSync(big[3]); }, expect: 'chunk 3 of media/house-mori/item-sports-1/original is missing' },
      // 最後の塊を手前の塊で置き換えて、ファイルを短く見せる。
      { name: 'ending the file early', files: [big[3]], apply: () => { writeFileSync(big[3], readFileSync(big[2])); }, expect: 'chunk 3 of media/house-mori/item-sports-1/original does not authenticate' },
    ];
    for (const fault of faults) {
      const saved = fault.files.map((file) => [file, readFileSync(file)] as const);
      fault.apply();
      const result = await h.cli(['backup', 'verify', id]);
      expect(result.code, fault.name).toBe(2);
      expect(result.err, fault.name).toContain(fault.expect);
      for (const [file, bytes] of saved) writeFileSync(file, bytes);
      expect(await h.cli(['backup', 'verify', id]), fault.name).toMatchObject({ code: 0 });
    }
    // 別の世代の名前に置いた目録も読めない（AAD に世代の ID を入れている）。
    const renamed = id.replace(/-[0-9a-f]{6}$/, '-000000');
    writeFileSync(manifestPath(h.settings.dir, renamed), readFileSync(manifest));
    expect(await h.cli(['backup', 'verify', renamed])).toMatchObject({ code: 2, err: expect.stringContaining('manifest does not authenticate') });
    // 一覧でも、読めない世代を示して2で終わる。
    expect(await h.cli(['backup', 'list'])).toMatchObject({ code: 2, out: expect.stringContaining(`${renamed} unreadable`) });
  });

  it('binds each chunk to its file, position and end in the AAD', () => {
    const keys = new BackupKeys(KEY);
    const blob = 'a'.repeat(64);
    const sealed = keys.sealChunk(blob, 1, false, Buffer.from('plaintext'));
    expect(keys.openChunk(blob, 1, false, sealed).toString()).toBe('plaintext');
    expect(() => keys.openChunk(blob, 0, false, sealed)).toThrow();
    expect(() => keys.openChunk(blob, 1, true, sealed)).toThrow();
    expect(() => keys.openChunk('b'.repeat(64), 1, false, sealed)).toThrow();
    expect(() => new BackupKeys('x'.repeat(40)).openChunk(blob, 1, false, sealed)).toThrow();
  });

  it('exits 2 when the manifest leaves out a media file the database references', async () => {
    const h = await household();
    const { id } = await createGeneration(h.settings, h.sources);
    const keys = new BackupKeys(KEY);
    const body = JSON.parse(keys.openManifest(id, readFileSync(manifestPath(h.settings.dir, id)))) as { files: Array<{ path: string }> };
    body.files = body.files.filter((file) => file.path !== 'media/house-mori/item-park-1/original');
    writeFileSync(manifestPath(h.settings.dir, id), keys.sealManifest(id, JSON.stringify(body)));
    expect(await h.cli(['backup', 'verify', id])).toMatchObject({ code: 2, err: expect.stringContaining('referenced by the database are not in the generation, first media/house-mori/item-park-1/original') });
  });

  it('answers 1 for usage errors and an unknown generation', async () => {
    const h = await household();
    expect(await h.cli(['backup'])).toMatchObject({ code: 1, err: expect.stringContaining('usage') });
    expect(await h.cli(['backup', 'verify'])).toMatchObject({ code: 1 });
    expect(await h.cli(['backup', 'verify', '../../etc/passwd'])).toMatchObject({ code: 1, err: expect.stringContaining('no generation') });
    expect(await h.cli(['restore', '2026-11-03T030000-abcdef'])).toMatchObject({ code: 1, err: expect.stringContaining('usage') });
    expect((await runBackupCommand(['backup', 'list'], { config: { ...h.config, backup: null }, out: () => undefined, err: () => undefined, openSources: () => { throw new Error('not used'); } }))).toBe(1);
  });
});

describe('restore (A8-5, A8-7)', () => {
  it('restores into a new directory, and the API started on the restored files reads the same household', async () => {
    const h = await household();
    expect((await h.world.gateway.todos.createTodo({ title: 'バックアップの前', assigneeMembershipId: 'member-aoi' })).ok).toBe(true);
    const before = await h.world.gateway.household.getSnapshot();
    const { id } = await createGeneration(h.settings, h.sources);
    expect((await h.world.gateway.todos.createTodo({ title: 'バックアップの後', assigneeMembershipId: 'member-aoi' })).ok).toBe(true);

    const target = join(h.root, 'restored');
    const restored = await h.cli(['restore', id, '--to', target]);
    expect(restored).toMatchObject({ code: 0, err: '' });
    expect(restored.out).toContain(`FAMILY_HUB_DATABASE=${join(target, 'family-hub.sqlite')}`);
    for (const [path, bytes] of h.files) {
      expect(readFileSync(join(target, path)).equals(bytes), path).toBe(true);
      expect(statSync(join(target, path)).mode & 0o777).toBe(0o600);
    }

    const again = createWorld('member-aoi', undefined, undefined, {}, { databasePath: join(target, 'family-hub.sqlite'), auditDatabasePath: join(target, 'audit.db'), mediaPath: join(target, 'media') });
    worlds.push(again);
    const after = await again.gateway.household.getSnapshot();
    expect(after.ok && before.ok).toBe(true);
    // 時計から作る値（今の時刻）だけを除いて、記録はすべて同じ。
    const records = (result: typeof before) => { if (!result.ok) return null; const { context, ...rest } = result.value; return { ...rest, context: { ...context, asOf: '', sync: { ...context.sync, lastSyncedAt: '' } } }; };
    expect(records(after)).toEqual(records(before));
    expect(JSON.stringify(after)).not.toContain('バックアップの後');
    // 復元したメディアを API が配る。
    const album = await again.gateway.albums.getAlbum('album-sports');
    const item = album.ok ? album.value.items.find((entry) => entry.id === 'item-sports-1') : undefined;
    const { url, cookies } = await again.ready;
    const file = await fetch(`${url}${again.gateway.albums.mediaUrl(item!, 'file')}`, { headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } });
    expect(Buffer.from(await file.arrayBuffer()).equals(h.files.get(BIG)!)).toBe(true);
    // 監査の記録の鎖も、目録の基準点までそろっている。
    expect(again.deps.audit.verifyAll('2026-11-03T09:00:00+09:00').ok).toBe(true);
  });

  it('never writes over files, and refuses while the API holds its lock', async () => {
    const h = await household();
    const { id } = await createGeneration(h.settings, h.sources);
    const occupied = join(h.root, 'occupied');
    mkdirSync(occupied);
    writeFileSync(join(occupied, 'family-hub.sqlite'), 'keep me');
    expect(await h.cli(['restore', id, '--to', occupied])).toMatchObject({ code: 1, err: expect.stringContaining('must be a new or empty directory') });
    expect(readFileSync(join(occupied, 'family-hub.sqlite'), 'utf8')).toBe('keep me');
    expect(await h.cli(['restore', id, '--to', join(occupied, 'family-hub.sqlite')])).toMatchObject({ code: 1 });
    expect(await h.cli(['restore', id, '--to', dirname(h.databasePath)])).toMatchObject({ code: 1 });

    const api = new FileLock(serverLockPath(h.databasePath)!, 'api');
    expect(api.tryAcquire()).toBe(true);
    const target = join(h.root, 'while-running');
    expect(await h.cli(['restore', id, '--to', target])).toMatchObject({ code: 1, err: expect.stringContaining(`(pid ${process.pid}) is running`) });
    expect(existsSync(target)).toBe(false);
    api.release();
    expect(await h.cli(['restore', id, '--to', target])).toMatchObject({ code: 0 });
  });

  it('stops with the reason when the keyring lacks a key that seals two-step secrets in the generation', async () => {
    const k1 = new Keyring({ keys: [{ kid: 'k1', secret: 'k'.repeat(40) }], activeKid: 'k1' });
    const h = await household({ keys: k1 });
    h.world.deps.db.run('UPDATE users SET totp_secret = ? WHERE id = ?', k1.seal('totp-secret', 'user-aoi', Buffer.from('two-step secret')), 'user-aoi');
    const { id } = await createGeneration(h.settings, h.sources);
    expect((await readManifest(h.settings, id)).keys).toEqual([{ kid: 'k1', fingerprint: k1.fingerprint('k1'), required: true }]);

    const target = join(h.root, 'restored');
    const without = new Keyring({ keys: [{ kid: 'k2', secret: 'n'.repeat(40) }], activeKid: 'k2' });
    expect(await h.cli(['restore', id, '--to', target], without)).toMatchObject({ code: 1, err: expect.stringContaining('the keyring has no key k1') });
    expect(existsSync(target)).toBe(false);
    const changed = new Keyring({ keys: [{ kid: 'k1', secret: 'c'.repeat(40) }], activeKid: 'k1' });
    expect(await h.cli(['restore', id, '--to', target], changed)).toMatchObject({ code: 1, err: expect.stringContaining('the secret of key k1 differs') });
    expect(existsSync(target)).toBe(false);
    expect(await h.cli(['restore', id, '--to', target, '--allow-missing-key', 'k1'], without)).toMatchObject({ code: 0 });
    expect(await h.cli(['restore', id, '--to', join(h.root, 'with-key')], k1)).toMatchObject({ code: 0 });
  });
});

describe('generations daily 7, weekly 4, monthly 6 (A8-4)', () => {
  const day = (date: string) => `${date}T030000-000000`;
  const dates = (from: string, count: number) => Array.from({ length: count }, (_, index) => new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));

  it('keeps exactly the newest of each of 7 days, the first of each of 4 weeks and of 6 months', () => {
    const year = dates('2026-01-01', 365);
    let ids: string[] = [];
    for (const date of year) {
      ids = [...generationsToKeep([...ids, day(date)], date).keys()].sort();
      expect(ids.length).toBeLessThanOrEqual(17);
      // 6か月より前の世代は残らない。
      expect(Date.parse(date) - Date.parse(ids[0].slice(0, 10))).toBeLessThan(184 * 86_400_000);
    }
    expect(ids.map((id) => id.slice(0, 10))).toEqual([
      '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', // 月
      '2026-12-01', '2026-12-07', '2026-12-14', '2026-12-21', // 月・週
      '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', // 日（12-28 は週も）
    ]);
    // 同じ日に2つあれば、日ごとの世代は新しい方。週と月の世代は、その期間の最初に成功した世代。
    const kept = generationsToKeep(['2026-12-31T030000-000000', '2026-12-31T150000-000000'], '2026-12-31');
    expect(kept.get('2026-12-31T150000-000000')).toEqual(['daily']);
    expect(kept.get('2026-12-31T030000-000000')).toEqual(['weekly', 'monthly']);
  });

  it('runs real backups over a simulated calendar and keeps exactly the expected generations and chunks', async () => {
    const h = await household();
    // 3月30日（月曜）の実行は失敗したものとする。その週の世代は3月31日になる。
    const days = dates('2026-01-01', 100).filter((date) => date !== '2026-03-30');
    for (const date of days) {
      h.world.deps.db.run('INSERT INTO rate_limits (bucket, count, window_started_at) VALUES (?, 1, 0)', `simulated-${date}`);
      const result = await createGeneration(h.settings, h.sources, { now: new Date(`${date}T03:00:00+09:00`) });
      expect(result.id.startsWith(`${date}T030000-`)).toBe(true);
      expect((await listGenerations(h.settings.dir)).length).toBeLessThanOrEqual(17);
    }
    expect((await listGenerations(h.settings.dir)).map((id) => id.slice(0, 10))).toEqual([
      '2026-01-01', '2026-02-01', '2026-03-01', '2026-03-16', '2026-03-23', '2026-03-31', '2026-04-01',
      '2026-04-04', '2026-04-05', '2026-04-06', '2026-04-07', '2026-04-08', '2026-04-09', '2026-04-10',
    ]);
    // 塊は、残った世代が参照するものだけ。
    const keys = new BackupKeys(KEY);
    const referenced = new Set<string>();
    for (const id of await listGenerations(h.settings.dir)) for (const file of (await readManifest(h.settings, id)).files) for (let index = 0; index < file.chunks; index += 1) referenced.add(keys.chunkName(file.blob, index, index === file.chunks - 1));
    expect(new Set(allFiles(join(h.settings.dir, 'chunks')).map((file) => file.slice(-64)))).toEqual(referenced);
  }, 120_000);

  it('counts days in the household time zone', () => {
    expect(localTime(new Date('2026-11-02T18:30:00Z'), 'Asia/Tokyo')).toMatchObject({ date: '2026-11-03', time: '033000', offsetMinutes: 540 });
  });
});

describe('the retention job and backups share a lock (A8-2)', () => {
  it('does not delete files while a backup runs, and deletes them afterwards', async () => {
    const h = await household();
    h.world.deps.db.run("UPDATE records SET body = json_set(body, '$.deletedAt', ?) WHERE collection = 'albumItems' AND id = ?", '2026-08-01T00:00:00+09:00', 'item-park-1');
    const file = join(h.media, 'house-mori', 'item-park-1', 'original');
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const atChunks = new Promise<void>((done) => { reached = done; });
    const running = createGeneration(h.settings, h.sources, { stage: async (stage) => { if (stage === 'chunks') { reached(); await gate; } } });
    await atChunks;
    expect(await runRetention(h.world.deps)).toBeNull();
    expect(existsSync(file)).toBe(true);
    release();
    const { id } = await running;
    expect((await readManifest(h.settings, id)).files.some((item) => item.path === 'media/house-mori/item-park-1/original')).toBe(true);
    expect(await runRetention(h.world.deps)).toBe(1);
    expect(existsSync(file)).toBe(false);

    const retention = maintenanceLock(h.media);
    expect(retention.tryAcquire()).toBe(true);
    await expect(createGeneration(h.settings, h.sources)).rejects.toBeInstanceOf(BackupBusyError);
    expect(await h.cli(['backup', 'now'])).toMatchObject({ code: 1, err: expect.stringContaining('running') });
    retention.release();
    expect((await createGeneration(h.settings, h.sources)).id).toBeTruthy();
  });
});

describe('the daily schedule and the settings (A8-1)', () => {
  it('runs once a day after the set time, and tries again an hour after a failure', async () => {
    const h = await household();
    let now = new Date('2026-11-03T02:59:00+09:00');
    const lines: string[] = [];
    const tick = createBackupScheduler(h.config.backup!, h.sources, { info: (line) => lines.push(line), error: (line) => lines.push(line) }, () => now);
    expect(await tick()).toBe('not-due');
    now = new Date('2026-11-03T03:00:00+09:00');
    expect(await tick()).toBe('created');
    expect(lines.at(-1)).toMatch(/^backup: generation 2026-11-03T030000-[0-9a-f]{6} created and verified/);
    now = new Date('2026-11-03T09:00:00+09:00');
    expect(await tick()).toBe('done');
    now = new Date('2026-11-04T02:59:00+09:00');
    expect(await tick()).toBe('not-due');
    const lock = maintenanceLock(h.media);
    lock.tryAcquire();
    now = new Date('2026-11-04T03:00:00+09:00');
    expect(await tick()).toBe('busy');
    now = new Date('2026-11-04T03:30:00+09:00');
    expect(await tick()).toBe('waiting');
    lock.release();
    now = new Date('2026-11-04T04:00:00+09:00');
    expect(await tick()).toBe('created');
    expect(await listGenerations(h.settings.dir)).toHaveLength(2);
  });

  it('turns automatic backups off without the folder or the key, and refuses a weak or shared key', () => {
    const keyring = { keys: [{ kid: 'legacy', secret: 's'.repeat(40) }], activeKid: 'legacy' };
    expect(loadBackup({}, keyring)).toBeNull();
    expect(loadBackup({ FAMILY_HUB_BACKUP_DIR: '/backups' }, keyring)).toBeNull();
    expect(loadBackup({ FAMILY_HUB_BACKUP_KEY: KEY }, keyring)).toBeNull();
    expect(loadBackup({ FAMILY_HUB_BACKUP_DIR: '/backups', FAMILY_HUB_BACKUP_KEY: KEY }, keyring)).toEqual({ dir: '/backups', key: KEY, at: { hour: 3, minute: 0 }, timeZone: 'Asia/Tokyo' });
    expect(loadBackup({ FAMILY_HUB_BACKUP_DIR: '/backups', FAMILY_HUB_BACKUP_KEY: KEY, FAMILY_HUB_BACKUP_AT: '23:45', FAMILY_HUB_BACKUP_TZ: 'UTC' }, keyring)).toMatchObject({ at: { hour: 23, minute: 45 }, timeZone: 'UTC' });
    expect(() => loadBackup({ FAMILY_HUB_BACKUP_DIR: '/backups', FAMILY_HUB_BACKUP_KEY: 'short' }, keyring)).toThrow('at least 32 characters');
    expect(() => loadBackup({ FAMILY_HUB_BACKUP_DIR: '/backups', FAMILY_HUB_BACKUP_KEY: 's'.repeat(40) }, keyring)).toThrow('must differ');
    expect(() => loadBackup({ FAMILY_HUB_BACKUP_AT: '3:00' }, keyring)).toThrow('FAMILY_HUB_BACKUP_AT');
    expect(() => loadBackup({ FAMILY_HUB_BACKUP_TZ: 'Mars/Base' }, keyring)).toThrow('FAMILY_HUB_BACKUP_TZ');
  });
});
