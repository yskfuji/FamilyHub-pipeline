import { randomUUID } from 'node:crypto';
import { toJstRfc3339 } from '../src/domain/calendarDate';
import { loadConfig } from './config';
import { Db } from './db/db';

/**
 * 運営者の手元の命令。支払いの仕組みがないので、利用期間の延長と停止はここで行う。
 * HTTP の経路は持たず、データベースのある機械でだけ実行できる。すべて監査の記録に残す。
 *
 *   list                       家族グループの利用状態を表示する
 *   grant <household> [days]   利用期間を延ばす（days を省くと期限なし）
 *   expire <household>         利用を止める
 *   suspend <membership>       メンバーの参加を止める
 *   resume <membership>        メンバーの参加を戻す
 */
const [command, target, argument] = process.argv.slice(2);
const db = new Db(loadConfig().databasePath);
const now = toJstRfc3339(new Date());
const audit = (householdId: string, action: string, detail: string) => db.run("INSERT INTO audit_events (id, household_id, actor_user_id, action, target, detail, at) VALUES (?, ?, 'operator', ?, ?, ?, ?)", `audit-${randomUUID()}`, householdId, action, target ?? null, detail, now);

function setMembershipStatus(status: 'active' | 'suspended') {
  const member = db.get<{ household_id: string }>('SELECT household_id FROM household_members WHERE membership_id = ?', target);
  const row = member ? db.get<{ body: string }>("SELECT body FROM records WHERE household_id = ? AND collection = 'memberships' AND id = ?", member.household_id, target) : undefined;
  if (!member || !row) throw new Error('membership not found');
  const body = JSON.parse(row.body) as { status: string; version: number };
  db.run("UPDATE records SET body = ? WHERE household_id = ? AND collection = 'memberships' AND id = ?", JSON.stringify({ ...body, status, version: body.version + 1 }), member.household_id, target);
  audit(member.household_id, `operator.${status}`, '');
}

if (command === 'list') {
  for (const row of db.all<{ household_id: string; status: string; ends_at: string | null }>('SELECT household_id, status, ends_at FROM entitlements ORDER BY household_id')) console.log(row.household_id, row.status, row.ends_at ?? '-');
} else if (command === 'grant' && target) {
  const endsAt = argument ? new Date(Date.now() + Number(argument) * 86_400_000).toISOString() : null;
  db.transaction(() => {
    db.run("INSERT INTO entitlements (household_id, status, ends_at, updated_at) VALUES (?, 'active', ?, ?) ON CONFLICT(household_id) DO UPDATE SET status = 'active', ends_at = excluded.ends_at, updated_at = excluded.updated_at", target, endsAt, now);
    audit(target, 'operator.grant', endsAt ?? 'open');
  });
} else if (command === 'expire' && target) {
  db.transaction(() => { db.run("UPDATE entitlements SET status = 'expired', updated_at = ? WHERE household_id = ?", now, target); audit(target, 'operator.expire', ''); });
} else if ((command === 'suspend' || command === 'resume') && target) {
  db.transaction(() => setMembershipStatus(command === 'suspend' ? 'suspended' : 'active'));
} else {
  console.error('usage: list | grant <household> [days] | expire <household> | suspend <membership> | resume <membership>');
  process.exitCode = 1;
}
db.close();
