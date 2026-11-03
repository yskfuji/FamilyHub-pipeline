import { toJstRfc3339 } from '../src/domain/calendarDate';
import { AuditLog } from './audit/log';
import { AuditStore } from './audit/store';
import { loadConfig } from './config';
import { Db } from './db/db';
import { runOperatorCommand } from './operator';

/** 運営者の手元の命令の入口。命令の一覧と終了コードは server/operator.ts。API と同じ環境変数で実行する。 */
const config = loadConfig();
const db = new Db(config.databasePath);
const store = new AuditStore(config.auditDatabasePath);
const audit = new AuditLog(db, store);
try {
  process.exitCode = runOperatorCommand(process.argv.slice(2), { db, keys: config.keys, now: toJstRfc3339(new Date()), out: (line) => console.log(line), err: (line) => console.error(line), audit, auditRetentionMonths: config.auditRetentionMonths });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'failed');
  process.exitCode = 1;
} finally {
  // 命令が箱に書いた監査の記録を audit.db へ移す。動いている API と同時でも、重ならず鎖も分かれない。
  audit.flush();
  store.close();
  db.close();
}
