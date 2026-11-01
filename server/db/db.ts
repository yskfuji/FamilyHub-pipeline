import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { migrations } from './migrations';

export type Row = Record<string, SQLInputValue>;

/** データベースの入口はこのファイルだけにする。駆動の差し替えをここで閉じるため。 */
export class Db {
  private readonly raw: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate() {
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
    try {
      const value = work();
      this.raw.exec(commitWhen(value) ? 'COMMIT' : 'ROLLBACK');
      return value;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close() { this.raw.close(); }
}
