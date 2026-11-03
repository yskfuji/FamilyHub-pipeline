import { toJstRfc3339 } from '../src/domain/calendarDate';
import { loadConfig } from './config';
import { Db } from './db/db';
import { runOperatorCommand } from './operator';

/** 運営者の手元の命令の入口。命令の一覧と終了コードは server/operator.ts。API と同じ環境変数で実行する。 */
const config = loadConfig();
const db = new Db(config.databasePath);
try {
  process.exitCode = runOperatorCommand(process.argv.slice(2), { db, keys: config.keys, now: toJstRfc3339(new Date()), out: (line) => console.log(line), err: (line) => console.error(line) });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'failed');
  process.exitCode = 1;
} finally {
  db.close();
}
