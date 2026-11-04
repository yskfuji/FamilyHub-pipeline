import { mkdir, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AuditLog } from '../audit/log';
import type { ServerConfig } from '../config';
import type { Db } from '../db/db';
import { BackupBusyError, createGeneration, generationTiers, GenerationNotFoundError, keyProblems, listGenerations, missingWarning, readManifest, restoreGeneration, verifyGeneration } from './backup';
import type { BackupSettings } from './backup';
import { BackupFormatError } from './format';
import { lockHolder, maintenanceLock, serverLockPath } from './lock';

/**
 * バックアップの命令（A8-5）。API と同じ環境変数で実行する。
 *
 *   backup now                       世代を1つ作り、読み戻して確かめてから確定する。古い世代を片付ける
 *   backup list                      世代の一覧（ID・作った日時・ファイルの数・大きさ・残る理由）
 *   backup verify <id>               世代を確かめる（復号・hash・DB の検査・参照するメディア・監査の基準点）。
 *                                    作るときに欠けていたと目録に記録したメディアは警告（終了コード0）にし、記録のない欠けは失敗にする
 *   restore <id> --to <dir> [--allow-missing-key <kid>]...
 *                                    空のディレクトリへ復元する。動いているファイルは上書きしない。
 *                                    ロックを持つ API が動いている間と、必要な鍵が鍵束にないときは断る
 *
 * 終了コード: 0 は成功、1 は使い方の誤りか断った（理由を標準エラーに出す）、2 は検証の失敗。
 */
export interface BackupCommandEnv {
  config: ServerConfig;
  out(line: string): void;
  err(line: string): void;
  /** backup now のときだけ開く。本体の DB と監査の記録。 */
  openSources(): { db: Db; audit: AuditLog; close(): void };
  now?: () => Date;
}

export const isBackupCommand = (argv: readonly string[]) => argv[0] === 'backup' || argv[0] === 'restore';
const usage = 'usage: backup now | backup list | backup verify <id> | restore <id> --to <dir> [--allow-missing-key <kid>]...';

function parseRestore(argv: readonly string[]) {
  const [, id, ...rest] = argv;
  if (!id || id.startsWith('--')) return null;
  let to: string | undefined;
  const allowed: string[] = [];
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (!value) return null;
    if (flag === '--to' && to === undefined) to = value;
    else if (flag === '--allow-missing-key') allowed.push(value);
    else return null;
  }
  return to ? { id, to, allowed } : null;
}

export async function runBackupCommand(argv: readonly string[], env: BackupCommandEnv): Promise<number> {
  const { config, out, err } = env;
  const now = env.now ?? (() => new Date());
  const refuse = (reason: string) => { err(reason); return 1; };
  const [command, target, argument] = argv;
  const restore = command === 'restore' ? parseRestore(argv) : null;
  const known = (command === 'backup' && ((target === 'now' || target === 'list') && argv.length === 2 || target === 'verify' && argument && argv.length === 3)) || restore;
  if (!known) return refuse(usage);
  const backup = config.backup;
  if (!backup) return refuse('backups are not configured: set FAMILY_HUB_BACKUP_DIR and FAMILY_HUB_BACKUP_KEY (at least 32 characters)');
  const settings: BackupSettings = { dir: backup.dir, key: backup.key, timeZone: backup.timeZone };

  // 検証の失敗は2、ないもの・使用中は1。
  const fail = (error: unknown) => {
    if (error instanceof BackupFormatError) { err(`verification failed: ${error.message}`); return 2; }
    if (error instanceof GenerationNotFoundError || error instanceof BackupBusyError) return refuse(error.message);
    return refuse(error instanceof Error ? error.message : 'failed');
  };
  /** 確かめる間と復元の間は、塊を片付ける実行と重ならないようにロックを持つ。 */
  const withLock = async (work: () => Promise<number>) => {
    const lock = maintenanceLock(config.mediaPath);
    if (!lock.tryAcquire()) return refuse('a backup or the retention job is running; try again later');
    try { return await work(); } catch (error) { return fail(error); } finally { lock.release(); }
  };

  if (command === 'backup' && target === 'now') {
    const sources = env.openSources();
    try {
      const result = await createGeneration(settings, { db: sources.db, audit: sources.audit, mediaPath: config.mediaPath }, { now: now() });
      out(`created ${result.id}: ${result.files} file(s), ${result.bytes} byte(s), ${result.writtenChunks} new chunk(s); verified`);
      if (result.missing.length) err(missingWarning(result.id, result.missing));
      out(`removed ${result.removedGenerations.length} generation(s) and ${result.removedChunks} unreferenced chunk(s)${result.collected ? '' : ' (chunks kept: a manifest could not be read)'}`);
      return 0;
    } catch (error) {
      return fail(error);
    } finally {
      sources.close();
    }
  }

  if (command === 'backup' && target === 'list') {
    const tiers = await generationTiers(settings, now());
    let unreadable = 0;
    for (const id of await listGenerations(settings.dir)) {
      try {
        const manifest = await readManifest(settings, id);
        out(`${id} ${manifest.createdAt} files=${manifest.files.length} bytes=${manifest.files.reduce((sum, file) => sum + file.size, 0)} keep=${(tiers.get(id) ?? []).join(',') || '-'}${manifest.missing?.length ? ` missing=${manifest.missing.length}` : ''}`);
      } catch (error) {
        // 一覧を作る間に、ほかの実行が片付けた世代。
        if (error instanceof GenerationNotFoundError) continue;
        unreadable += 1;
        out(`${id} unreadable (${error instanceof Error ? error.message : 'unknown'})`);
      }
    }
    return unreadable ? 2 : 0;
  }

  if (command === 'backup' && target === 'verify' && argument) {
    return withLock(async () => {
      const manifest = await verifyGeneration(settings, argument);
      const missing = manifest.missing ?? [];
      out(`ok ${manifest.id}: ${manifest.files.length} file(s) decrypted and matched their hashes; databases pass integrity_check and foreign_key_check; ${missing.length ? `every referenced media file is present except ${missing.length} recorded as missing when the generation was made` : 'every referenced media file is present'}; audit anchor seq ${manifest.audit.seq}`);
      if (missing.length) err(missingWarning(manifest.id, missing));
      return 0;
    });
  }

  if (restore) {
    const serverLock = serverLockPath(config.databasePath);
    const holder = serverLock ? lockHolder(serverLock) : null;
    if (holder?.alive) return refuse(`the API (pid ${holder.pid}) is running on ${config.databasePath}; stop it before restoring`);
    const destination = resolve(restore.to);
    const existing = await stat(destination).catch(() => null);
    if (existing && (!existing.isDirectory() || (await readdir(destination)).length > 0)) return refuse(`${destination} must be a new or empty directory; restore never writes over existing files`);
    return withLock(async () => {
      const manifest = await readManifest(settings, restore.id);
      const problems = keyProblems(manifest, config.keys).filter((problem) => !restore.allowed.includes(problem.kid));
      if (problems.length) {
        for (const problem of problems) err(problem.reason === 'missing' ? `the keyring has no key ${problem.kid}, which seals two-step secrets in this generation; add it to FAMILY_HUB_KEYS` : `the secret of key ${problem.kid} differs from the one recorded in this generation; use the earlier secret`);
        err('restore stopped. To restore anyway, pass --allow-missing-key <kid>; those people will sign in with a recovery code or a passkey and set up the two-step code again');
        return 1;
      }
      await mkdir(destination, { recursive: true, mode: 0o700 });
      const restored = await restoreGeneration(settings, manifest, destination);
      out(`restored ${manifest.id} (created ${manifest.createdAt}) to ${destination}; verified`);
      if (manifest.missing?.length) err(missingWarning(manifest.id, manifest.missing));
      out(`FAMILY_HUB_DATABASE=${restored.database}`);
      out(`FAMILY_HUB_AUDIT_DB=${restored.audit}`);
      out(`FAMILY_HUB_MEDIA=${restored.media}`);
      return 0;
    });
  }
  return refuse(usage);
}
