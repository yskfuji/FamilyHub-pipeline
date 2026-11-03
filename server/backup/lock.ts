import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * 処理をまたぐ排他のためのロックファイル。作るときに O_EXCL で作り、中に PID を書く。
 * すでにあれば、その PID の処理が生きている間は使用中とする（自分の PID でも使用中）。
 * 処理が止まって残ったファイル（PID が生きていない）は、消してから取り直す。
 */
export class FileLock {
  private held = false;

  constructor(readonly path: string, private readonly purpose: string) {}

  /** 取れたら true。使用中なら false。 */
  tryAcquire(): boolean {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.path, 'wx', 0o600);
        try { writeSync(fd, `${process.pid}\n${hostname()}\n${this.purpose}\n${new Date().toISOString()}\n`); } finally { closeSync(fd); }
        this.held = true;
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const holder = lockHolder(this.path);
        if (holder && holder.alive) return false;
        // 止まった処理が残したファイル。消してから取り直す。
        try { unlinkSync(this.path); } catch (unlinkError) { if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError; }
      }
    }
    return false;
  }

  release() {
    if (!this.held) return;
    this.held = false;
    try {
      if (readFileSync(this.path, 'utf8').startsWith(`${process.pid}\n`)) unlinkSync(this.path);
    } catch { /* すでにない */ }
  }
}

export interface LockHolder { pid: number; purpose: string; alive: boolean }

/** ロックファイルを持つ処理。ファイルがなければ null。 */
export function lockHolder(path: string): LockHolder | null {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  const [pidText, , purpose] = text.split('\n');
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) {
    // 作った直後で、まだ PID を書いていないファイル。しばらくは使用中とみなす。
    let young = false;
    try { young = Date.now() - statSync(path).mtimeMs < 10_000; } catch { return null; }
    return { pid: 0, purpose: purpose ?? '', alive: young };
  }
  // 置き場所は1台の機械のものとして、同じ機械の PID として確かめる。
  try {
    process.kill(pid, 0);
    return { pid, purpose: purpose ?? '', alive: true };
  } catch (error) {
    // EPERM は、別の利用者の処理が生きていることを表す。
    return { pid, purpose: purpose ?? '', alive: (error as NodeJS.ErrnoException).code === 'EPERM' };
  }
}

/**
 * メディアの手入れのロック。バックアップの実行と、期限切れのファイルを消す処理（server/jobs.ts）が同時に動かないようにする。
 * API と運営者の命令の両方が使うので、FAMILY_HUB_MEDIA の中に置く。
 */
export const maintenanceLock = (mediaPath: string) => new FileLock(join(mediaPath, '.maintenance.lock'), 'maintenance');

/** 動いている API のロック。復元の命令は、これを持つ API が動いている間は断る。 */
export const serverLockPath = (databasePath: string) => (databasePath === ':memory:' ? null : `${databasePath}.server.lock`);

/**
 * API の起動のときに取る。同じ DB で別の API が動いていれば起動しない。終わるときに放す（止まって残ったファイルは次に取り直す）。
 */
export function holdServerLock(databasePath: string) {
  const path = serverLockPath(databasePath);
  if (!path) return;
  const lock = new FileLock(path, 'api');
  if (!lock.tryAcquire()) throw new Error(`another API is running on ${databasePath} (pid ${lockHolder(path)?.pid ?? 'unknown'}); stop it first`);
  process.on('exit', () => lock.release());
}
