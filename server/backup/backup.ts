import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { AuditLog } from '../audit/log';
import { AuditStore } from '../audit/store';
import { totpReferences } from '../auth/keyring';
import type { Keyring } from '../auth/keyring';
import { Db } from '../db/db';
import { GENERATION_ID, generationsToKeep, localTime, newGenerationId, rfc3339 } from './calendar';
import type { Tier } from './calendar';
import { BackupFormatError, BackupKeys, DEFAULT_CHUNK_SIZE, isSafePath, parseManifest } from './format';
import type { FileRole, Manifest, ManifestFile, ManifestKey } from './format';
import { maintenanceLock } from './lock';

/**
 * 暗号化したバックアップ（A8）。置き場所の中身:
 *
 *   chunks/<2桁>/<塊の名前>   暗号化した塊（世代の間で共有する）
 *   generations/<ID>.fhm      暗号化した目録。これがあるものだけが世代として見える
 *   tmp/                      実行の途中のファイル。次の実行が片付ける
 *
 * 1回の実行: メディアの手入れのロックを取り → 本体の DB と audit.db を SQLite のバックアップ API で一時ファイルへ写し、
 * 読むだけで開いて integrity_check と foreign_key_check を確かめ → 写した DB が参照するメディアと DB の写しを塊にして保存し →
 * 目録を一時ファイルに書き → その世代を読み戻して全部を確かめ（復号・hash・DB の検査・参照するメディアがそろうこと）→
 * 目録を rename で置いて確定する → 残す数を超えた世代を消し、どの世代も参照しない塊を消す。
 * 途中で止まっても、目録がなければ世代は見えない。
 */
export interface BackupSettings { dir: string; key: string; timeZone: string; chunkSize?: number }
export interface BackupSources { db: Db; audit: AuditLog; mediaPath: string }
export type BackupStage = 'snapshot' | 'chunks' | 'manifest' | 'verify' | 'commit' | 'prune';
export interface CreateOptions { now?: Date; stage?: (stage: BackupStage) => void | Promise<void> }
export interface CreateResult { id: string; files: number; bytes: number; writtenChunks: number; removedGenerations: string[]; removedChunks: number; collected: boolean }

/** ほかのバックアップか、期限切れのファイルを消す処理が動いている。 */
export class BackupBusyError extends Error {}
/** その世代がない。 */
export class GenerationNotFoundError extends Error {}
/** 写した DB が参照するファイルが、読む間に消えたか変わった。写し直す。 */
class RetryableError extends Error {}

const MAIN_FILE = 'family-hub.sqlite';
const AUDIT_FILE = 'audit.db';
const ATTEMPTS = 3;

const chunkPath = (dir: string, name: string) => join(dir, 'chunks', name.slice(0, 2), name);
export const manifestPath = (dir: string, id: string) => join(dir, 'generations', `${id}.fhm`);
const exists = (path: string) => stat(path).then(() => true, () => false);

async function syncDirectory(path: string) {
  try {
    const handle = await open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch { /* ディレクトリの同期に対応しない環境 */ }
}

async function writeAtomically(path: string, data: Buffer) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
}

async function readFull(handle: FileHandle, buffer: Buffer, position: number) {
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, position + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return filled;
}

/** 写した DB が参照するメディアのファイル（置き場所からの相対の位置）。アルバムの準備ができた写真と動画、確認が終わった添付。 */
export function mediaReferences(db: Db): string[] {
  const paths: string[] = [];
  for (const row of db.all<{ household_id: string; id: string; thumbnail: number | null }>("SELECT household_id, id, json_extract(body, '$.hasThumbnail') AS thumbnail FROM records WHERE collection = 'albumItems' AND json_extract(body, '$.status') = 'ready'")) {
    paths.push(`media/${row.household_id}/${row.id}/original`);
    if (row.thumbnail) paths.push(`media/${row.household_id}/${row.id}/thumbnail.jpg`);
  }
  for (const row of db.all<{ household_id: string; id: string }>("SELECT records.household_id AS household_id, json_extract(attachment.value, '$.id') AS id FROM records, json_each(records.body, '$.attachments') AS attachment WHERE records.collection = 'memos' AND json_extract(attachment.value, '$.status') = 'clean'")) {
    paths.push(`media/${row.household_id}/${row.id}/original`);
  }
  return [...new Set(paths)].sort();
}

/** 写した DB の鍵の指紋。確認コードの秘密の暗号化に使っている kid は、復元に必要（required）。 */
export function keyRequirements(db: Db): ManifestKey[] {
  const references = totpReferences(db);
  const recorded = new Map(db.all<{ kid: string; fingerprint: string }>('SELECT kid, fingerprint FROM key_fingerprints').map((row) => [row.kid, row.fingerprint]));
  return [...new Set([...recorded.keys(), ...Object.keys(references)])].sort().map((kid) => ({ kid, fingerprint: recorded.get(kid) ?? null, required: (references[kid] ?? 0) > 0 }));
}

/** integrity_check が 'ok' の1行だけで、foreign_key_check が空なら null。違えば理由。 */
export function databaseProblem(path: string): string | null {
  let db: Db | undefined;
  try {
    db = new Db(path, { access: 'readOnly' });
    const integrity = db.all<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') return `integrity_check: ${integrity.slice(0, 3).map((row) => row.integrity_check).join('; ')}`;
    const foreign = db.all<{ table: string }>('PRAGMA foreign_key_check');
    if (foreign.length) return `foreign_key_check: ${foreign.length} row(s), first in ${foreign[0].table}`;
    return null;
  } catch (error) {
    // 壊れ方によっては、検査の前に読めない（database disk image is malformed など）。
    return `integrity_check: ${error instanceof Error ? error.message : 'unreadable'}`;
  } finally {
    db?.close();
  }
}

interface SnapshotFacts { media: string[]; keys: ManifestKey[]; audit: { seq: number; hash: string } }

function readFacts(mainPath: string, auditPath: string): SnapshotFacts {
  const main = new Db(mainPath, { access: 'readOnly' });
  const auditStore = new AuditStore(new Db(auditPath, { access: 'readOnly' }));
  try {
    return { media: mediaReferences(main), keys: keyRequirements(main), audit: auditStore.tail() };
  } finally {
    auditStore.close();
    main.close();
  }
}

/** 写しを1つのファイルにまとめ（WAL をやめる）、検査する。 */
async function snapshotDatabase(source: Db, path: string) {
  await source.backupTo(path);
  new Db(path, { access: 'single' }).close();
  const problem = databaseProblem(path);
  if (problem) throw new BackupFormatError(`the copy of ${path.endsWith(AUDIT_FILE) ? AUDIT_FILE : MAIN_FILE} failed the check (${problem})`);
}

/** ファイルを塊にして保存する。すでにある塊は書かない。読む間に変わったら写し直す。 */
async function storeFile(dir: string, keys: BackupKeys, chunkSize: number, source: string, path: string, role: FileRole): Promise<{ file: ManifestFile; written: number }> {
  let handle: FileHandle;
  try {
    handle = await open(source, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RetryableError(`${path} is referenced but missing`);
    throw error;
  }
  try {
    const buffer = Buffer.alloc(chunkSize);
    const blobHash = keys.blobHasher();
    const sha256 = createHash('sha256');
    let size = 0;
    for (;;) {
      const read = await readFull(handle, buffer, size);
      blobHash.update(buffer.subarray(0, read));
      sha256.update(buffer.subarray(0, read));
      size += read;
      if (read < chunkSize) break;
    }
    const blob = blobHash.digest('hex');
    const chunks = Math.max(1, Math.ceil(size / chunkSize));
    const names = Array.from({ length: chunks }, (_, index) => keys.chunkName(blob, index, index === chunks - 1));
    let written = 0;
    if (!(await Promise.all(names.map((name) => exists(chunkPath(dir, name))))).every(Boolean)) {
      const again = keys.blobHasher();
      let offset = 0;
      for (let index = 0; index < chunks; index += 1) {
        const read = await readFull(handle, buffer, offset);
        const plaintext = buffer.subarray(0, read);
        again.update(plaintext);
        offset += read;
        const target = chunkPath(dir, names[index]);
        if (await exists(target)) continue;
        await writeAtomically(target, keys.sealChunk(blob, index, index === chunks - 1, plaintext));
        written += 1;
      }
      const beyond = await readFull(handle, Buffer.alloc(1), offset);
      if (offset !== size || beyond !== 0 || again.digest('hex') !== blob) throw new RetryableError(`${path} changed while it was read`);
    }
    return { file: { path, role, size, sha256: sha256.digest('hex'), blob, chunks }, written };
  } finally {
    await handle.close();
  }
}

/** 塊から1つのファイルを読み、hash と大きさを確かめる。sink があれば平文を書く。 */
async function readStoredFile(dir: string, keys: BackupKeys, chunkSize: number, file: ManifestFile, sink?: FileHandle) {
  const sha256 = createHash('sha256');
  const blobHash = keys.blobHasher();
  let size = 0;
  for (let index = 0; index < file.chunks; index += 1) {
    const last = index === file.chunks - 1;
    let stored: Buffer;
    try {
      stored = await readFile(chunkPath(dir, keys.chunkName(file.blob, index, last)));
    } catch {
      throw new BackupFormatError(`chunk ${index} of ${file.path} is missing`);
    }
    let plaintext: Buffer;
    try {
      plaintext = keys.openChunk(file.blob, index, last, stored);
    } catch {
      throw new BackupFormatError(`chunk ${index} of ${file.path} does not authenticate (changed, swapped or moved)`);
    }
    if (!last && plaintext.length !== chunkSize) throw new BackupFormatError(`chunk ${index} of ${file.path} has the wrong length`);
    sha256.update(plaintext);
    blobHash.update(plaintext);
    size += plaintext.length;
    if (sink) await sink.write(plaintext);
  }
  if (size !== file.size || sha256.digest('hex') !== file.sha256 || blobHash.digest('hex') !== file.blob) throw new BackupFormatError(`${file.path} does not match its recorded size and hash`);
}

export async function listGenerations(dir: string): Promise<string[]> {
  const names = await readdir(join(dir, 'generations')).catch(() => [] as string[]);
  return names.filter((name) => name.endsWith('.fhm')).map((name) => name.slice(0, -4)).filter((id) => GENERATION_ID.test(id)).sort();
}

export async function readManifest(settings: BackupSettings, id: string, file = manifestPath(settings.dir, id)): Promise<Manifest> {
  if (!GENERATION_ID.test(id)) throw new GenerationNotFoundError(`no generation ${id}`);
  let stored: Buffer;
  try {
    stored = await readFile(file);
  } catch {
    throw new GenerationNotFoundError(`no generation ${id}`);
  }
  const keys = new BackupKeys(settings.key);
  const body = keys.openManifest(id, stored);
  try {
    return parseManifest(id, body);
  } catch (error) {
    if (error instanceof BackupFormatError) throw error;
    throw new BackupFormatError('manifest is not readable');
  }
}

/**
 * 世代の全部を確かめる。target にはファイルを書く（復元。media も書く）。target がなければ、DB だけを一時ファイルに書いて検査し、メディアは hash だけを確かめる。
 * 食い違いは BackupFormatError。
 */
async function extract(settings: BackupSettings, manifest: Manifest, target: string, writeMedia: boolean) {
  const keys = new BackupKeys(settings.key);
  const root = resolve(target);
  for (const file of manifest.files) {
    if (file.role === 'media' && !writeMedia) {
      await readStoredFile(settings.dir, keys, manifest.chunkSize, file);
      continue;
    }
    const destination = resolve(root, file.path);
    if (!destination.startsWith(`${root}${sep}`)) throw new BackupFormatError(`path ${file.path}`);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(destination, 'wx', 0o600);
    try {
      await readStoredFile(settings.dir, keys, manifest.chunkSize, file, handle);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  const main = join(root, MAIN_FILE);
  const audit = join(root, AUDIT_FILE);
  for (const path of [main, audit]) {
    const problem = databaseProblem(path);
    if (problem) throw new BackupFormatError(`${path.endsWith(AUDIT_FILE) ? AUDIT_FILE : MAIN_FILE}: ${problem}`);
  }
  const facts = readFacts(main, audit);
  const stored = new Set(manifest.files.filter((file) => file.role === 'media').map((file) => file.path));
  const missing = facts.media.filter((path) => !stored.has(path));
  if (missing.length) throw new BackupFormatError(`${missing.length} media file(s) referenced by the database are not in the generation, first ${missing[0]}`);
  if (stored.size !== facts.media.length) throw new BackupFormatError('the generation holds media files the database does not reference');
  if (facts.audit.seq !== manifest.audit.seq || facts.audit.hash !== manifest.audit.hash) throw new BackupFormatError(`the audit file ends at seq ${facts.audit.seq}, the manifest records seq ${manifest.audit.seq}`);
  if (JSON.stringify(facts.keys) !== JSON.stringify(manifest.keys)) throw new BackupFormatError('the key fingerprints differ from the manifest');
}

/** 世代を確かめる（復号・hash・DB の検査・参照するメディア・監査の基準点・鍵の指紋）。 */
export async function verifyGeneration(settings: BackupSettings, id: string, file?: string): Promise<Manifest> {
  const manifest = await readManifest(settings, id, file);
  await mkdir(join(settings.dir, 'tmp'), { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(settings.dir, 'tmp', 'verify-'));
  try {
    await extract(settings, manifest, scratch, false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return manifest;
}

/** 必要な鍵のうち、今の鍵束にない、または指紋が違うもの。 */
export interface KeyProblem { kid: string; reason: 'missing' | 'different' }
export function keyProblems(manifest: Manifest, keyring: Keyring): KeyProblem[] {
  return manifest.keys.filter((key) => key.required).flatMap((key): KeyProblem[] => {
    if (!keyring.has(key.kid)) return [{ kid: key.kid, reason: 'missing' }];
    if (key.fingerprint && keyring.fingerprint(key.kid) !== key.fingerprint) return [{ kid: key.kid, reason: 'different' }];
    return [];
  });
}

/** 空のディレクトリ target へ復元する。失敗したら書いたものを消す。 */
export async function restoreGeneration(settings: BackupSettings, manifest: Manifest, target: string) {
  try {
    await extract(settings, manifest, target, true);
  } catch (error) {
    for (const entry of await readdir(target).catch(() => [] as string[])) await rm(join(target, entry), { recursive: true, force: true });
    throw error;
  }
  return { database: join(resolve(target), MAIN_FILE), audit: join(resolve(target), AUDIT_FILE), media: join(resolve(target), 'media') };
}

async function attempt(settings: BackupSettings, sources: BackupSources, keys: BackupKeys, at: Date, stage: CreateOptions['stage']) {
  const chunkSize = settings.chunkSize ?? DEFAULT_CHUNK_SIZE;
  await mkdir(join(settings.dir, 'tmp'), { recursive: true, mode: 0o700 });
  const run = await mkdtemp(join(settings.dir, 'tmp', 'run-'));
  try {
    await stage?.('snapshot');
    sources.audit.flush();
    const main = join(run, MAIN_FILE);
    const audit = join(run, AUDIT_FILE);
    await snapshotDatabase(sources.db, main);
    await snapshotDatabase(sources.audit.store.db, audit);
    const facts = readFacts(main, audit);
    const unsafe = facts.media.find((path) => !isSafePath(path));
    if (unsafe) throw new BackupFormatError(`the database refers to a media file outside the media folder (${unsafe.slice(0, 80)})`);

    await stage?.('chunks');
    const files: ManifestFile[] = [];
    let written = 0;
    const store = async (source: string, path: string, role: FileRole) => {
      const stored = await storeFile(settings.dir, keys, chunkSize, source, path, role);
      files.push(stored.file);
      written += stored.written;
    };
    await store(main, MAIN_FILE, 'database');
    await store(audit, AUDIT_FILE, 'audit');
    for (const path of facts.media) await store(join(sources.mediaPath, path.slice('media/'.length)), path, 'media');

    await stage?.('manifest');
    const id = newGenerationId(at, settings.timeZone);
    const manifest: Manifest = { format: 1, id, createdAt: rfc3339(at, settings.timeZone), timeZone: settings.timeZone, chunkSize, audit: facts.audit, keys: facts.keys, files };
    const pending = join(run, 'manifest.fhm');
    await writeAtomically(pending, keys.sealManifest(id, JSON.stringify(manifest)));

    // 確定する前に、置き場所から読み戻して全部を確かめる。
    await stage?.('verify');
    await verifyGeneration(settings, id, pending);

    await stage?.('commit');
    await mkdir(join(settings.dir, 'generations'), { recursive: true, mode: 0o700 });
    await rename(pending, manifestPath(settings.dir, id));
    await syncDirectory(join(settings.dir, 'generations'));
    return { id, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), writtenChunks: written };
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}

/** 残す世代のほかを消し、どの世代も参照しない塊と、止まった実行の一時ファイルを消す。目録を読めない世代が残っていれば、塊は消さない。 */
export async function pruneGenerations(settings: BackupSettings, today: string): Promise<{ removedGenerations: string[]; removedChunks: number; collected: boolean }> {
  const ids = await listGenerations(settings.dir);
  const kept = generationsToKeep(ids, today);
  const removedGenerations = ids.filter((id) => !kept.has(id));
  for (const id of removedGenerations) await rm(manifestPath(settings.dir, id), { force: true });
  for (const entry of await readdir(join(settings.dir, 'tmp')).catch(() => [] as string[])) await rm(join(settings.dir, 'tmp', entry), { recursive: true, force: true });
  const keys = new BackupKeys(settings.key);
  const referenced = new Set<string>();
  for (const id of kept.keys()) {
    let manifest: Manifest;
    try { manifest = await readManifest(settings, id); } catch { return { removedGenerations, removedChunks: 0, collected: false }; }
    for (const file of manifest.files) for (let index = 0; index < file.chunks; index += 1) referenced.add(keys.chunkName(file.blob, index, index === file.chunks - 1));
  }
  let removedChunks = 0;
  for (const prefix of await readdir(join(settings.dir, 'chunks')).catch(() => [] as string[])) {
    for (const name of await readdir(join(settings.dir, 'chunks', prefix)).catch(() => [] as string[])) {
      if (referenced.has(name)) continue;
      await rm(join(settings.dir, 'chunks', prefix, name), { force: true });
      removedChunks += 1;
    }
  }
  return { removedGenerations, removedChunks, collected: true };
}

/** 世代を1つ作って確定し、古い世代を片付ける。メディアの手入れのロックを持つ間に行う。 */
export async function createGeneration(settings: BackupSettings, sources: BackupSources, options: CreateOptions = {}): Promise<CreateResult> {
  const keys = new BackupKeys(settings.key);
  const lock = maintenanceLock(sources.mediaPath);
  if (!lock.tryAcquire()) throw new BackupBusyError('another backup or the retention job is running');
  try {
    await mkdir(settings.dir, { recursive: true, mode: 0o700 });
    const at = options.now ?? new Date();
    let created: Awaited<ReturnType<typeof attempt>> | undefined;
    for (let count = 1; !created; count += 1) {
      try {
        created = await attempt(settings, sources, keys, at, options.stage);
      } catch (error) {
        // 写した後に消された・変わったメディアは、写し直せば合う。何度写しても合わなければ、検証の失敗として止める。
        if (!(error instanceof RetryableError)) throw error;
        if (count >= ATTEMPTS) throw new BackupFormatError(error.message);
      }
    }
    await options.stage?.('prune');
    const pruned = await pruneGenerations(settings, localTime(at, settings.timeZone).date);
    return { ...created, ...pruned };
  } finally {
    lock.release();
  }
}

/** 世代ごとの、残る理由（日・週・月）。一覧の表示に使う。 */
export async function generationTiers(settings: BackupSettings, at: Date): Promise<Map<string, Tier[]>> {
  return generationsToKeep(await listGenerations(settings.dir), localTime(at, settings.timeZone).date);
}
