import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { migrations as mainMigrations } from './migrations';

export type Row = Record<string, SQLInputValue>;

export interface DbOptions {
  /** スキーマの変更の並び。既定は本体の DB のもの。監査の記録（audit.db）は自分の並びを渡す。 */
  migrations?: readonly string[];
  /** ファイルの権限。作るときに付け、すでにあるファイルも開く前にこの権限へそろえる。 */
  mode?: number;
  /**
   * バックアップの写しを確かめるときに使う。readOnly は読むだけで開き、スキーマの変更も設定の変更もしない。
   * single は WAL をやめて1つのファイルにまとめる（写しを暗号化する前と、復元したファイル）。
   */
  access?: 'readOnly' | 'single';
}

/** データベースの入口はこのファイルだけにする。駆動の差し替えをここで閉じるため。 */
export class Db {
  private readonly raw: DatabaseSync;
  private depth = 0;
  private committed: Array<() => void> = [];
  readonly path: string;

  constructor(path: string, options: DbOptions = {}) {
    this.path = path;
    if (path !== ':memory:' && options.access !== 'readOnly') {
      // 既定でも、持ち主だけが読み書きできるようにする（パスワードの hash や家族の記録を、同じ機械のほかの利用者に見せない。侵入試験 PT-PERMS）。
      const mode = options.mode ?? 0o600;
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // SQLite は WAL と共有メモリのファイルを、本体のファイルと同じ権限で作る。
      closeSync(openSync(path, 'a', mode));
      chmodSync(path, mode);
    }
    if (options.access === 'readOnly') {
      this.raw = new DatabaseSync(path, { readOnly: true });
      return;
    }
    this.raw = new DatabaseSync(path);
    if (options.access === 'single') {
      this.raw.exec('PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      return;
    }
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate(options.migrations ?? mainMigrations);
  }

  /**
   * SQLite のバックアップ API で、動いている間も一貫した写しを path へ作る（A8）。
   * 少しずつ写し、その間に同じ接続で書いた分も写しに含まれる。写したページの数を返す。
   */
  backupTo(path: string, options: { rate?: number; progress?: (progress: { totalPages: number; remainingPages: number }) => void } = {}): Promise<number> {
    return backup(this.raw, path, { rate: options.rate ?? 256, progress: options.progress });
  }

  private migrate(migrations: readonly string[]) {
    const version = Number((this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    for (let index = version; index < migrations.length; index += 1) {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        this.raw.exec(migrations[index]);
        this.raw.exec(`PRAGMA user_version = ${Number(index + 1)}`);
        this.raw.exec('COMMIT');
      } catch (error) {
        this.raw.exec('ROLLBACK');
        throw error;
      }
    }
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.raw.prepare(sql).run(...params);
  }

  /** 同期の処理を1つのトランザクションで行う。入れ子の呼び出しは外側に含まれる。 */
  transaction<T>(work: () => T, commitWhen: (value: T) => boolean = () => true): T {
    if (this.depth > 0) return work();
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth += 1;
    let commit = false;
    try {
      const value = work();
      if (commitWhen(value)) { this.raw.exec('COMMIT'); commit = true; } else this.raw.exec('ROLLBACK');
      return value;
    } catch (error) {
      commit = false;
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth -= 1;
      const pending = this.committed;
      this.committed = [];
      if (commit) for (const callback of pending) callback();
    }
  }

  /**
   * 確定した後に行う処理。トランザクションの中なら COMMIT の後に1回だけ呼び、ROLLBACK なら捨てる。
   * 外なら（文はその場で確定しているので）すぐに呼ぶ。監査の記録を audit.db へ移すのに使う。
   */
  afterCommit(callback: () => void) {
    if (this.depth > 0) this.committed.push(callback);
    else callback();
  }

  close() { this.raw.close(); }
}
