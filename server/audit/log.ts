import type { Db } from '../db/db';
import type { Anchor, ChainFields, ChainProblem, VerifyResult } from './chain';
import { RECENT_ROWS } from './store';
import type { AuditStore } from './store';

/** 監査の記録に残す1件。本文・秘密・トークン・IP は入れない。detail は変えた項目の名前（{"fields":[...]}）だけ。 */
export interface AuditEventInput {
  id: string;
  at: string;
  householdId: string | null;
  actorUserId: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
}

/** 鎖の確認の結果。管理者の画面（変更の記録）に出す。 */
export interface AuditChainStatus { state: 'ok' | 'problem' | 'unchecked'; checkedAt: string | null; problem: ChainProblem | null }

export interface AuditLogger { info(line: string): void; error(line: string): void }

/** 本体の DB の送り出しの箱へ書く。呼び出し側のトランザクションに含まれる。 */
export function writeOutbox(db: Db, event: AuditEventInput) {
  db.run('INSERT INTO audit_outbox (id, household_id, actor_user_id, action, target, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)', event.id, event.householdId, event.actorUserId, event.action, event.target ?? null, event.detail ?? null, event.at);
}

/**
 * 送り出しの箱の行を audit.db へ移す。先に audit.db へ追記（INSERT OR IGNORE）して確定し、その後で箱から消す。
 * 2つの間で止まっても、次の回に同じ行を移し直すだけで、重ならず（id が UNIQUE）欠けもしない。
 * WAL では ATTACH した2つのファイルをまたぐトランザクションは全体として原子的にならないので、この順にしている。
 */
export function drainOutbox(db: Db, store: AuditStore, batch = 500): number {
  let moved = 0;
  for (;;) {
    const rows = db.all<ChainFields & { seq: number }>('SELECT seq, id, at, household_id, actor_user_id, action, target, detail FROM audit_outbox ORDER BY seq LIMIT ?', batch);
    if (!rows.length) return moved;
    moved += store.append(rows);
    db.run('DELETE FROM audit_outbox WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(rows.map((row) => row.id)));
  }
}

const dayOf = (at: string) => at.slice(0, 10);

/** 監査の記録の入口。書く・移す・確かめる・基準点を残す。API と運営者の命令の両方が使う。 */
export class AuditLog {
  status: AuditChainStatus = { state: 'unchecked', checkedAt: null, problem: null };

  constructor(readonly db: Db, readonly store: AuditStore, private readonly logger: AuditLogger = { info: (line) => console.log(line), error: (line) => console.error(line) }) {}

  /** 変更と同じトランザクションで箱に書き、確定した後に audit.db へ移す。 */
  record(event: AuditEventInput) {
    writeOutbox(this.db, event);
    this.db.afterCommit(() => { this.flush(); });
  }

  /** 箱に残っている行を移す。失敗しても変更の操作は失敗させない（次の回に移す）。 */
  flush(): number {
    try {
      return drainOutbox(this.db, this.store);
    } catch (error) {
      this.logger.error(`audit: could not move records to the audit file yet (${error instanceof Error ? error.message : 'unknown'}); they stay in the outbox`);
      return 0;
    }
  }

  /** 基準点を残した記録（本体の DB の控え）。 */
  anchors(): Anchor[] {
    return this.db.all<Anchor>('SELECT seq, hash FROM audit_anchors ORDER BY seq').map((row) => ({ seq: Number(row.seq), hash: row.hash }));
  }

  /** 今の基準点（鎖の末尾）。バックアップの目録に入れる。 */
  currentAnchor(): Anchor { return this.store.tail(); }

  /** その日の基準点をまだ残していなければ、運用ログと本体の DB に残す。 */
  anchorDaily(now: string): Anchor | null {
    this.flush();
    const day = dayOf(now);
    if (this.db.get('SELECT day FROM audit_anchors WHERE day = ?', day)) return null;
    const anchor = this.store.tail();
    this.db.run('INSERT OR IGNORE INTO audit_anchors (day, seq, hash, at) VALUES (?, ?, ?, ?)', day, anchor.seq, anchor.hash, now);
    this.logger.info(`audit anchor day=${day} seq=${anchor.seq} hash=${anchor.hash}`);
    return anchor;
  }

  /** 直近の分を確かめ、結果を管理者の画面に出す状態として持つ。失敗は運用ログにも出す。起動を止めない。 */
  verifyRecent(now: string, rows = RECENT_ROWS): VerifyResult {
    this.flush();
    return this.remember(this.store.verify(this.anchors(), rows), now);
  }

  /** 全体を確かめる。extra は運用ログなど外から渡す基準点。 */
  verifyAll(now: string, extra: readonly Anchor[] = []): VerifyResult {
    this.flush();
    return this.remember(this.store.verify([...this.anchors(), ...extra]), now);
  }

  private remember(result: VerifyResult, now: string) {
    const [problem] = result.problems;
    this.status = { state: result.ok ? 'ok' : 'problem', checkedAt: now, problem: problem ?? null };
    if (problem) this.logger.error(`audit: the chain check failed at seq ${problem.seq} (${problem.kind}: ${problem.detail}); ${result.problems.length} problem(s) in all`);
    return result;
  }
}
