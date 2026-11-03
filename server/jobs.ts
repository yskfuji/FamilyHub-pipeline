import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHouseholdRules } from '../src/domain/commands';
import { purgeExpired } from '../src/domain/commands/trash';
import { planNotifications } from '../src/domain/notificationPlan';
import { loadAggregate, saveAggregate } from './db/aggregateStore';
import { purgeReadings } from './assistant/jobs';
import type { AppDeps } from './http/context';
import { originalPath, quarantinePath } from './media/pipeline';
import { retentionCutoff } from './operator';

const defaults = { privacy: { defaultAudience: 'household' as const, hideNotificationContent: true, placeLookupConsent: null }, notificationPreferences: { todoDue: true, eventDeparture: true, quietHours: true } };
const IDEMPOTENCY_KEEP_MS = 72 * 3_600_000;

/** 削除から30日を過ぎた記録とファイルを消し、期限切れの一時的な記録を片付ける。 */
export async function runRetention(deps: AppDeps) {
  const now = deps.clock.now();
  const files: Array<{ householdId: string; id: string }> = [];
  for (const { household_id: householdId } of deps.db.all<{ household_id: string }>('SELECT DISTINCT household_id FROM household_members')) {
    deps.db.transaction(() => {
      const loaded = loadAggregate(deps.db, householdId, '', defaults, { media: true });
      for (const id of purgeExpired(loaded.aggregate, now)) files.push({ householdId, id });
      saveAggregate(deps.db, householdId, '', loaded, { media: true });
    });
  }
  for (const file of files) await rm(dirname(originalPath(deps.config.mediaPath, file.householdId, file.id)), { recursive: true, force: true });
  const cutoff = new Date(Date.parse(now) - IDEMPOTENCY_KEEP_MS).toISOString();
  deps.db.run('DELETE FROM idempotency_records WHERE unixepoch(created_at) < unixepoch(?)', cutoff);
  deps.db.run('DELETE FROM sessions WHERE unixepoch(expires_at) < unixepoch(?) OR unixepoch(revoked_at) < unixepoch(?)', now, cutoff);
  deps.db.run('DELETE FROM webauthn_challenges WHERE unixepoch(expires_at) < unixepoch(?)', now);
  deps.db.run('DELETE FROM password_resets WHERE unixepoch(expires_at) < unixepoch(?)', cutoff);
  for (const row of deps.db.all<{ id: string; household_id: string; item_id: string }>('SELECT id, household_id, item_id FROM uploads WHERE unixepoch(expires_at) < unixepoch(?)', now)) {
    await rm(quarantinePath(deps.config.mediaPath, row.id), { force: true });
    deps.db.transaction(() => {
      deps.db.run("DELETE FROM records WHERE household_id = ? AND collection = 'albumItems' AND id = ?", row.household_id, row.item_id);
      deps.db.run('DELETE FROM uploads WHERE id = ?', row.id);
    });
  }
  await purgeReadings(deps);
  return files.length;
}

/** 記録からこれからの通知を作り、人ごとに保存する。すでにある通知は変えない。 */
export function generateNotifications(deps: AppDeps) {
  const now = deps.clock.now();
  for (const member of deps.db.all<{ household_id: string; membership_id: string }>('SELECT household_id, membership_id FROM household_members')) {
    deps.db.transaction(() => {
      const loaded = loadAggregate(deps.db, member.household_id, member.membership_id, defaults);
      const rules = createHouseholdRules(loaded.aggregate, { actorMembershipId: member.membership_id, now: deps.clock.now, nextId: deps.ids.next, newInviteToken: deps.ids.inviteToken });
      const known = new Set(loaded.aggregate.notifications.map((item) => item.id));
      const fresh = planNotifications(rules.context.project(), now).filter((item) => !known.has(item.id));
      if (!fresh.length) return;
      loaded.aggregate.notifications.push(...fresh);
      saveAggregate(deps.db, member.household_id, member.membership_id, loaded);
    });
  }
}

/**
 * 監査の記録の毎日の手入れ。その日の基準点を運用ログと本体の DB に残し、直近の分の鎖を確かめ、
 * 保持の期間（既定24か月）を過ぎた分を checkpoint を残してから消す。同じ日に何度呼んでもよい。
 */
export function runAuditDaily(deps: AppDeps) {
  const now = deps.clock.now();
  const months = deps.config.auditRetentionMonths;
  if (months > 0) deps.audit.store.prune(retentionCutoff(now, months), now, deps.ids.next('audit'));
  deps.audit.anchorDaily(now);
  deps.audit.verifyRecent(now);
}

export function startJobs(deps: AppDeps) {
  try { runAuditDaily(deps); } catch (error) { console.error(`audit: daily upkeep failed (${error instanceof Error ? error.message : 'unknown'})`); }
  const timers = [
    // 確定の後に移しそこねた監査の記録を、短い間隔で audit.db へ移す。
    setInterval(() => { deps.audit.flush(); }, 5_000),
    setInterval(() => { try { runAuditDaily(deps); } catch { /* 次の回でやり直す */ } }, 3_600_000),
    setInterval(() => { void runRetention(deps).catch(() => undefined); }, 3_600_000),
    setInterval(() => { try { generateNotifications(deps); } catch { /* 次の回でやり直す */ } }, 5 * 60_000),
  ];
  for (const timer of timers) timer.unref();
  return () => { for (const timer of timers) clearInterval(timer); };
}
