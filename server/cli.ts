import { toJstRfc3339 } from '../src/domain/calendarDate';
import { AuditLog } from './audit/log';
import { AuditStore } from './audit/store';
import { isBackupCommand, runBackupCommand } from './backup/command';
import { loadConfig } from './config';
import { Db } from './db/db';
import { runOperatorCommand } from './operator';

/** 運営者の手元の命令の入口。命令の一覧と終了コードは server/operator.ts と server/backup/command.ts。API と同じ環境変数で実行する。 */
const config = loadConfig();
const argv = process.argv.slice(2);
const out = (line: string) => console.log(line);
const err = (line: string) => console.error(line);

if (isBackupCommand(argv)) {
  // 復元と確認では本体の DB を開かない（新しい機械で、まだファイルがないときにも使えるように）。
  process.exitCode = await runBackupCommand(argv, {
    config, out, err,
    openSources: () => {
      const db = new Db(config.databasePath);
      const store = new AuditStore(config.auditDatabasePath);
      const audit = new AuditLog(db, store);
      return { db, audit, close: () => { audit.flush(); store.close(); db.close(); } };
    },
  }).catch((error: unknown) => { err(error instanceof Error ? error.message : 'failed'); return 1; });
} else {
  const db = new Db(config.databasePath);
  const store = new AuditStore(config.auditDatabasePath);
  const audit = new AuditLog(db, store);
  try {
    process.exitCode = runOperatorCommand(argv, { db, keys: config.keys, now: toJstRfc3339(new Date()), out, err, audit, auditRetentionMonths: config.auditRetentionMonths });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'failed');
    process.exitCode = 1;
  } finally {
    // 命令が箱に書いた監査の記録を audit.db へ移す。動いている API と同時でも、重ならず鎖も分かれない。
    audit.flush();
    store.close();
    db.close();
  }
}
