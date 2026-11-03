import type { AuditLog } from '../audit/log';
import type { BackupConfig } from '../config';
import type { Db } from '../db/db';
import { BackupBusyError, createGeneration, listGenerations } from './backup';
import { GENERATION_ID, localTime } from './calendar';

export interface BackupLogger { info(line: string): void; error(line: string): void }
export type TickResult = 'not-due' | 'done' | 'waiting' | 'running' | 'created' | 'busy' | 'failed';

const RETRY_MS = 3_600_000;

/**
 * 毎日の自動のバックアップ（A8-1）。決めた時刻（既定 03:00、家族の時間帯）を過ぎて、その時刻より後に作った世代が
 * 今日の分にまだなければ作る。API が止まっていて時刻を過ぎたときは、起動の後に作る。失敗したら1時間後にやり直す。
 * 毎週の自動の復元は行わない（世代は作るたびに読み戻して確かめる）。
 */
export function createBackupScheduler(settings: BackupConfig, sources: { db: Db; audit: AuditLog; mediaPath: string }, logger: BackupLogger, now: () => Date = () => new Date()) {
  let running = false;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  const due = settings.at.hour * 60 + settings.at.minute;
  const dueTime = `${String(settings.at.hour).padStart(2, '0')}${String(settings.at.minute).padStart(2, '0')}00`;

  return async function tick(): Promise<TickResult> {
    if (running) return 'running';
    const at = now();
    const local = localTime(at, settings.timeZone);
    if (local.minutes < due) return 'not-due';
    const done = (await listGenerations(settings.dir)).some((id) => { const match = GENERATION_ID.exec(id); return match?.[1] === local.date && match[2] >= dueTime; });
    if (done) return 'done';
    if (at.getTime() - lastAttempt < RETRY_MS) return 'waiting';
    running = true;
    lastAttempt = at.getTime();
    try {
      const result = await createGeneration(settings, sources, { now: at });
      logger.info(`backup: generation ${result.id} created and verified (${result.files} file(s), ${result.bytes} byte(s), ${result.writtenChunks} new chunk(s)); removed ${result.removedGenerations.length} generation(s) and ${result.removedChunks} chunk(s)${result.collected ? '' : '; chunks were not collected because a manifest could not be read'}`);
      return 'created';
    } catch (error) {
      if (error instanceof BackupBusyError) {
        logger.info('backup: another backup or the retention job is running; trying again in an hour');
        return 'busy';
      }
      logger.error(`backup: the daily backup failed (${error instanceof Error ? error.message : 'unknown'}); trying again in an hour`);
      return 'failed';
    } finally {
      running = false;
    }
  };
}
