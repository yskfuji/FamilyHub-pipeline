import { serverMessages } from '../../src/content/serverMessages';
import type { AssistantJob, AssistantJobKind, AssistantJobStatus } from '../../src/domain/assistant';
import type { Id } from '../../src/domain/types';
import { LlmError } from '../adapters/llm';
import { PageRefused } from '../adapters/urlFetcher';
import type { AppDeps } from '../http/context';
import { quarantinePath } from '../media/pipeline';
import { ReadingError, removeFile } from './reading';

const KEEP_FINISHED_MS = 3_600_000;

const failureMessages: Readonly<Record<string, string>> = {
  unreadable: serverMessages.readingFailed,
  malformed: serverMessages.readingFailed,
  timeout: serverMessages.readingTimeout,
  unavailable: serverMessages.readingUnavailable,
  interrupted: serverMessages.readingInterrupted,
  'not-safe': serverMessages.readingNotSafe,
  blocked: serverMessages.readingRefused,
  invalid: serverMessages.readingRefused,
  redirects: serverMessages.readingRefused,
  'not-text': serverMessages.readingRefused,
  'too-large': serverMessages.readingRefused,
  unreachable: serverMessages.readingPageFailed,
};

interface JobRow { id: string; household_id: string; user_id: string; kind: AssistantJobKind; status: AssistantJobStatus; file_id: string | null; result: string | null; error_code: string | null }

const failureCode = (error: unknown) => (error instanceof LlmError || error instanceof PageRefused || error instanceof ReadingError ? error.code : 'unreadable');

function finish(deps: AppDeps, id: Id, status: 'done' | 'failed', result: string | null, code: string | null) {
  deps.db.run('UPDATE assistant_jobs SET status = ?, result = ?, error_code = ?, finished_at = ? WHERE id = ?', status, result, code, deps.clock.now(), id);
}

/** 止まった処理の行は、ここで失敗にする。残すと、その家族がずっと次を始められない。 */
export function sweepInterrupted(deps: AppDeps, householdId?: string) {
  const rows = householdId
    ? deps.db.all<JobRow>("SELECT id, file_id FROM assistant_jobs WHERE status IN ('queued', 'running') AND household_id = ?", householdId)
    : deps.db.all<JobRow>("SELECT id, file_id FROM assistant_jobs WHERE status IN ('queued', 'running')");
  for (const row of rows) {
    if (deps.runningReads.has(row.id)) continue;
    finish(deps, row.id, 'failed', null, 'interrupted');
    if (row.file_id) void removeFile(quarantinePath(deps.config.mediaPath, row.file_id)).catch(() => undefined);
  }
}

export const hasActiveReading = (deps: AppDeps, householdId: string) => Boolean(deps.db.get("SELECT 1 AS found FROM assistant_jobs WHERE household_id = ? AND status IN ('queued', 'running')", householdId));

export function insertReading(deps: AppDeps, actor: { householdId: Id; userId: Id }, kind: AssistantJobKind, fileId: string | null) {
  const id = deps.ids.next('reading');
  deps.db.run("INSERT INTO assistant_jobs (id, household_id, user_id, kind, status, file_id, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)", id, actor.householdId, actor.userId, kind, fileId, deps.clock.now());
  deps.runningReads.add(id);
  return id;
}

/** 裏で読み取りを進める。結果や失敗の理由に中身は残さず、画像は成否にかかわらず消す。 */
export function runReading(deps: AppDeps, id: Id, fileId: string | null, work: () => Promise<object>) {
  const job = (async () => {
    try {
      deps.db.run("UPDATE assistant_jobs SET status = 'running' WHERE id = ?", id);
      finish(deps, id, 'done', JSON.stringify(await work()), null);
    } catch (error) {
      finish(deps, id, 'failed', null, failureCode(error));
    } finally {
      deps.runningReads.delete(id);
      if (fileId) await removeFile(quarantinePath(deps.config.mediaPath, fileId));
    }
  })().catch(() => undefined).finally(() => deps.jobs.delete(job));
  deps.jobs.add(job);
}

/** 本人の仕事だけを返す。ほかの人の仕事は、あるかどうかも分からないようにする。 */
export function findReading(deps: AppDeps, id: Id, userId: Id): AssistantJob | null {
  const row = deps.db.get<JobRow>('SELECT id, user_id, household_id, kind, status, file_id, result, error_code FROM assistant_jobs WHERE id = ? AND user_id = ?', id, userId);
  if (!row) return null;
  const base = { id: row.id, kind: row.kind, status: row.status };
  if (row.status === 'done') return { ...base, ...(JSON.parse(row.result ?? '{}') as Pick<AssistantJob, 'receipt' | 'events'>) };
  if (row.status === 'failed') return { ...base, message: failureMessages[row.error_code ?? ''] ?? serverMessages.readingFailed };
  return base;
}

/** 終わった仕事と、止まって残った画像を片付ける。 */
export async function purgeReadings(deps: AppDeps) {
  sweepInterrupted(deps);
  const cutoff = new Date(Date.parse(deps.clock.now()) - KEEP_FINISHED_MS).toISOString();
  for (const row of deps.db.all<{ id: string; file_id: string | null }>("SELECT id, file_id FROM assistant_jobs WHERE status IN ('done', 'failed') AND unixepoch(finished_at) < unixepoch(?)", cutoff)) {
    if (row.file_id) await removeFile(quarantinePath(deps.config.mediaPath, row.file_id));
    deps.db.run('DELETE FROM assistant_jobs WHERE id = ?', row.id);
  }
}
