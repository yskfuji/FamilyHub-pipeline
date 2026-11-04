import { AuditLog } from '../audit/log';
import { AuditStore } from '../audit/store';
import { createGeneration } from '../backup/backup';
import type { BackupStage } from '../backup/backup';
import { Db } from '../db/db';

/**
 * 試験の代役。バックアップを実行し、指定した段階で自分を SIGKILL で止める（後片付けの処理は何も動かない）。
 * 引数: 本体の DB、audit.db、メディアの置き場所、バックアップの置き場所、段階。鍵は環境変数 FAMILY_HUB_BACKUP_KEY。
 */
const [databasePath, auditPath, mediaPath, dir, stop] = process.argv.slice(2);
const db = new Db(databasePath);
const store = new AuditStore(auditPath);
const audit = new AuditLog(db, store, { info: () => undefined, error: () => undefined });
await createGeneration({ dir, key: process.env.FAMILY_HUB_BACKUP_KEY ?? '', timeZone: 'Asia/Tokyo', chunkSize: 64 * 1024 }, { db, audit, mediaPath }, {
  stage: (stage: BackupStage) => { if (stage === stop) process.kill(process.pid, 'SIGKILL'); },
});
console.log('finished without stopping');
