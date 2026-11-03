import { randomUUID } from 'node:crypto';
import { Keyring, syncKeyring, totpReferences } from './auth/keyring';
import { openTotpSecret, sealTotpSecret } from './auth/totp';
import type { Db } from './db/db';

/**
 * 運営者の手元の命令。支払いの仕組みがないので、利用期間の延長と停止はここで行う。
 * HTTP の経路は持たず、データベースのある機械でだけ実行できる。変更はすべて監査の記録に残す。
 *
 *   list                       家族グループの利用状態を表示する
 *   grant <household> [days]   利用期間を延ばす（days を省くと期限なし）
 *   expire <household>         利用を止める
 *   suspend <membership>       メンバーの参加を止める
 *   resume <membership>        メンバーの参加を戻す
 *   keys status                鍵ごとの状態と、二段階認証の秘密の件数を表示する
 *   keys rotate                二段階認証の秘密を、有効な鍵で1つのトランザクションで暗号化し直す（何度実行してもよい）
 *   keys retire <kid>          参照が0件の鍵を引退させる。引退した鍵では署名を確かめない
 *   totp reset --user <id>     その人の二段階認証と回復コードを消す（鍵をなくしたときの手当て）
 *
 * 終了コード: 0 は成功、1 は使い方の誤りか、断った（理由を標準エラーに出す）。
 */
export interface OperatorEnv {
  db: Db;
  keys: Keyring;
  now: string;
  out(line: string): void;
  err(line: string): void;
}

const usage = 'usage: list | grant <household> [days] | expire <household> | suspend <membership> | resume <membership> | keys status | keys rotate | keys retire <kid> | totp reset --user <id>';

export function runOperatorCommand(argv: readonly string[], env: OperatorEnv): number {
  const { db, keys, now, out, err } = env;
  const [command, target, argument, extra] = argv;
  const audit = (householdId: string | null, action: string, auditTarget: string | null, detail: string) => db.run("INSERT INTO audit_events (id, household_id, actor_user_id, action, target, detail, at) VALUES (?, ?, 'operator', ?, ?, ?, ?)", `audit-${randomUUID()}`, householdId, action, auditTarget, detail, now);
  const refuse = (reason: string) => { err(reason); return 1; };

  const setMembershipStatus = (status: 'active' | 'suspended') => {
    const member = db.get<{ household_id: string }>('SELECT household_id FROM household_members WHERE membership_id = ?', target);
    const row = member ? db.get<{ body: string }>("SELECT body FROM records WHERE household_id = ? AND collection = 'memberships' AND id = ?", member.household_id, target) : undefined;
    if (!member || !row) return refuse('membership not found');
    const body = JSON.parse(row.body) as { status: string; version: number };
    db.transaction(() => {
      db.run("UPDATE records SET body = ? WHERE household_id = ? AND collection = 'memberships' AND id = ?", JSON.stringify({ ...body, status, version: body.version + 1 }), member.household_id, target);
      audit(member.household_id, `operator.${status}`, target, '');
    });
    return 0;
  };

  if (command === 'list' && !target) {
    for (const row of db.all<{ household_id: string; status: string; ends_at: string | null }>('SELECT household_id, status, ends_at FROM entitlements ORDER BY household_id')) out(`${row.household_id} ${row.status} ${row.ends_at ?? '-'}`);
    return 0;
  }
  if (command === 'grant' && target) {
    if (argument !== undefined && !/^\d{1,5}$/.test(argument)) return refuse('days must be a whole number');
    const endsAt = argument ? new Date(Date.parse(now) + Number(argument) * 86_400_000).toISOString() : null;
    db.transaction(() => {
      db.run("INSERT INTO entitlements (household_id, status, ends_at, updated_at) VALUES (?, 'active', ?, ?) ON CONFLICT(household_id) DO UPDATE SET status = 'active', ends_at = excluded.ends_at, updated_at = excluded.updated_at", target, endsAt, now);
      audit(target, 'operator.grant', target, endsAt ?? 'open');
    });
    return 0;
  }
  if (command === 'expire' && target) {
    db.transaction(() => { db.run("UPDATE entitlements SET status = 'expired', updated_at = ? WHERE household_id = ?", now, target); audit(target, 'operator.expire', target, ''); });
    return 0;
  }
  if ((command === 'suspend' || command === 'resume') && target) return setMembershipStatus(command === 'suspend' ? 'suspended' : 'active');

  if (command === 'keys' && (target === 'status' || target === 'rotate' || target === 'retire')) {
    const report = syncKeyring(db, keys, now);
    if (target === 'status' && !argument) {
      out(`active ${report.activeKid}`);
      const recorded = db.all<{ kid: string }>('SELECT kid FROM key_fingerprints ORDER BY created_at, kid').map((row) => row.kid);
      for (const kid of [...new Set([...keys.kids(), ...recorded, ...Object.keys(report.references)])]) out(`${kid} ${keys.stateOf(kid)} totp=${report.references[kid] ?? 0}`);
      return 0;
    }
    if (target === 'rotate' && !argument) {
      let rotated = 0; let unreadable = 0;
      db.transaction(() => {
        for (const row of db.all<{ id: string; totp_secret: string }>('SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL ORDER BY id')) {
          if (row.totp_secret.startsWith('v2.') && Keyring.kidOf(row.totp_secret) === keys.activeKid) continue;
          const secret = openTotpSecret(keys, row.id, row.totp_secret);
          if (!secret) { unreadable += 1; continue; }
          db.run('UPDATE users SET totp_secret = ? WHERE id = ? AND totp_secret = ?', sealTotpSecret(keys, row.id, secret), row.id, row.totp_secret);
          rotated += 1;
        }
        audit(null, 'operator.keysRotate', keys.activeKid, JSON.stringify({ rotated, unreadable }));
      });
      out(`rotated ${rotated} to ${keys.activeKid}`);
      if (unreadable) err(`${unreadable} two-step secret(s) cannot be read with the keys at hand; they stay as they are (use totp reset --user <id>)`);
      return 0;
    }
    if (target === 'retire' && argument && !extra) {
      const kid = argument;
      const known = db.get<{ retired_at: string | null }>('SELECT retired_at FROM key_fingerprints WHERE kid = ?', kid);
      if (!known) return refuse(`unknown key ${kid}`);
      if (known.retired_at) { out(`${kid} already retired`); return 0; }
      if (kid === keys.activeKid) return refuse(`${kid} is the active key; make another key active first`);
      const references = totpReferences(db)[kid] ?? 0;
      if (references > 0) return refuse(`${kid} still seals ${references} two-step secret(s); run keys rotate first`);
      db.transaction(() => {
        db.run('UPDATE key_fingerprints SET retired_at = ? WHERE kid = ? AND retired_at IS NULL', now, kid);
        audit(null, 'operator.keysRetire', kid, '');
      });
      out(`retired ${kid}; restart the API, then remove it from FAMILY_HUB_KEYS`);
      return 0;
    }
  }

  if (command === 'totp' && target === 'reset' && argument === '--user' && extra && argv.length === 4) {
    const user = db.get<{ id: string }>('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', extra);
    if (!user) return refuse('user not found');
    const member = db.get<{ household_id: string }>('SELECT household_id FROM household_members WHERE user_id = ?', user.id);
    db.transaction(() => {
      db.run('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?', user.id);
      db.run('DELETE FROM recovery_codes WHERE user_id = ?', user.id);
      audit(member?.household_id ?? null, 'operator.totpReset', user.id, '');
    });
    out(`two-step code removed for ${user.id}`);
    return 0;
  }

  err(usage);
  return 1;
}
