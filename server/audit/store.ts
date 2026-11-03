import { Db } from '../db/db';
import { chainHash, PRUNE_ACTION, pruneDetail, verifyChain } from './chain';
import type { Anchor, ChainFields, ChainRow, Checkpoint, VerifyResult } from './chain';
import { auditMigrations, GENESIS_HASH } from './schema';

/** 一覧の絞り込み。どれも省略できる。actions は種類のまとまりを操作の名前に開いたもの。 */
export interface AuditFilter { actorUserId?: string; actions?: readonly string[]; from?: string; to?: string }
export type StoredEvent = Omit<ChainRow, 'prev_hash' | 'hash'>;

const NO_CURSOR = Number.MAX_SAFE_INTEGER;
/** 起動のときと毎日確かめる、直近の行の数。 */
export const RECENT_ROWS = 5000;

/**
 * 監査の記録のファイル（audit.db）。本体の DB とは別のファイルを、別の接続で開く。権限は 0600。
 * 追記は BEGIN IMMEDIATE の中で末尾を読んでから行うので、API と運営者の命令が同時に書いても鎖は分かれない。
 */
export class AuditStore {
  readonly db: Db;

  constructor(path: string) {
    this.db = new Db(path, { migrations: auditMigrations, mode: 0o600 });
  }

  /** 末尾の行（なければ最後の checkpoint、それもなければ起点）。 */
  tail(): Anchor {
    const row = this.db.get<Anchor>('SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1');
    if (row) return { seq: Number(row.seq), hash: row.hash };
    const checkpoint = this.latestCheckpoint();
    return checkpoint ? { seq: checkpoint.through_seq, hash: checkpoint.hash } : { seq: 0, hash: GENESIS_HASH };
  }

  latestCheckpoint(): Checkpoint | null {
    const row = this.db.get<Checkpoint>('SELECT through_seq, hash, pruned_before, pruned_rows, at FROM audit_checkpoints ORDER BY through_seq DESC LIMIT 1');
    return row ? { ...row, through_seq: Number(row.through_seq), pruned_rows: Number(row.pruned_rows) } : null;
  }

  /**
   * 行を鎖の末尾へ足す。同じ id の行がすでにあれば足さない（INSERT OR IGNORE。送り出しの箱から移す途中で止まっても重ならない）。
   * 足した行の数を返す。
   */
  append(rows: readonly ChainFields[]): number {
    return this.db.transaction(() => this.appendInTransaction(rows));
  }

  private appendInTransaction(rows: readonly ChainFields[]) {
    let { seq, hash } = this.tail();
    let appended = 0;
    for (const row of rows) {
      const fields: ChainFields = { id: row.id, at: row.at, household_id: row.household_id ?? null, actor_user_id: row.actor_user_id ?? null, action: row.action, target: row.target ?? null, detail: row.detail ?? null };
      const next = chainHash(hash, fields);
      const result = this.db.run('INSERT OR IGNORE INTO audit_events (seq, id, at, household_id, actor_user_id, action, target, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', seq + 1, fields.id, fields.at, fields.household_id, fields.actor_user_id, fields.action, fields.target, fields.detail, hash, next);
      if (Number(result.changes) === 1) { seq += 1; hash = next; appended += 1; }
    }
    return appended;
  }

  /**
   * 保持の期間を過ぎた行を消す。before（YYYY-MM-DD）より前の日付の行のうち、先頭から続く分だけが対象。
   * 1つのトランザクションで、(1) 消す区間の末尾の hash を checkpoint に残し、(2) そのことを鎖に1行足し、(3) 区間を消す。
   * DELETE の trigger は checkpoint が覆う行しか通さないので、行を消せるのはこの道だけになる。
   */
  prune(before: string, now: string, id: string): { pruned: number; checkpoint: Checkpoint | null } {
    return this.db.transaction(() => {
      const previous = this.latestCheckpoint()?.through_seq ?? 0;
      const firstKept = this.db.get<{ seq: number | null }>('SELECT min(seq) AS seq FROM audit_events WHERE substr(at, 1, 10) >= ?', before)?.seq;
      const last = this.db.get<{ seq: number | null }>('SELECT max(seq) AS seq FROM audit_events')?.seq;
      const through = firstKept === null || firstKept === undefined ? Number(last ?? 0) : Number(firstKept) - 1;
      if (through <= previous) return { pruned: 0, checkpoint: null };
      const end = this.db.get<{ hash: string }>('SELECT hash FROM audit_events WHERE seq = ?', through);
      if (!end) return { pruned: 0, checkpoint: null };
      const count = Number(this.db.get<{ count: number }>('SELECT count(*) AS count FROM audit_events WHERE seq <= ?', through)?.count ?? 0);
      const checkpoint: Checkpoint = { through_seq: through, hash: end.hash, pruned_before: before, pruned_rows: count, at: now };
      this.db.run('INSERT INTO audit_checkpoints (through_seq, hash, pruned_before, pruned_rows, at) VALUES (?, ?, ?, ?, ?)', checkpoint.through_seq, checkpoint.hash, checkpoint.pruned_before, checkpoint.pruned_rows, checkpoint.at);
      this.appendInTransaction([{ id, at: now, household_id: null, actor_user_id: 'operator', action: PRUNE_ACTION, target: null, detail: pruneDetail(checkpoint) }]);
      this.db.run('DELETE FROM audit_events WHERE seq <= ?', through);
      return { pruned: count, checkpoint };
    });
  }

  /** 鎖を確かめる。recent を渡すと、直近のその行数だけ（先頭の行の prev_hash を信じて）確かめる。基準点より後の切り捨ても見る。 */
  verify(anchors: readonly Anchor[], recent?: number): VerifyResult {
    const rows = recent === undefined
      ? this.db.all<ChainRow>('SELECT seq, id, at, household_id, actor_user_id, action, target, detail, prev_hash, hash FROM audit_events ORDER BY seq')
      : this.db.all<ChainRow>('SELECT seq, id, at, household_id, actor_user_id, action, target, detail, prev_hash, hash FROM audit_events WHERE seq > (SELECT max(seq) FROM audit_events) - ? ORDER BY seq', recent);
    return verifyChain({ rows: rows.map((row) => ({ ...row, seq: Number(row.seq) })), checkpoint: this.latestCheckpoint(), anchors, partial: recent !== undefined });
  }

  /** 家族の記録を新しい順に。cursor はその番号より前（古い側）から続ける。 */
  listHousehold(householdId: string, filter: AuditFilter, cursor: number | undefined, limit: number): StoredEvent[] {
    const actions = filter.actions ? JSON.stringify(filter.actions) : null;
    return this.db.all<StoredEvent>(`SELECT seq, id, at, household_id, actor_user_id, action, target, detail FROM audit_events
      WHERE household_id = ? AND seq < ?
        AND (? IS NULL OR actor_user_id = ?)
        AND (? IS NULL OR action IN (SELECT value FROM json_each(?)))
        AND (? IS NULL OR substr(at, 1, 10) >= ?)
        AND (? IS NULL OR substr(at, 1, 10) <= ?)
      ORDER BY seq DESC LIMIT ?`, householdId, cursor ?? NO_CURSOR, filter.actorUserId ?? null, filter.actorUserId ?? null, actions, actions, filter.from ?? null, filter.from ?? null, filter.to ?? null, filter.to ?? null, limit).map((row) => ({ ...row, seq: Number(row.seq) }));
  }

  /** 本人のアカウントの記録（家族に属さない操作）と、運営者がその人の確認コードを消した記録。 */
  listAccount(userId: string, cursor: number | undefined, limit: number): StoredEvent[] {
    return this.db.all<StoredEvent>(`SELECT seq, id, at, household_id, actor_user_id, action, target, detail FROM audit_events
      WHERE seq < ? AND ((actor_user_id = ? AND household_id IS NULL) OR (actor_user_id = 'operator' AND action = 'operator.totpReset' AND target = ?))
      ORDER BY seq DESC LIMIT ?`, cursor ?? NO_CURSOR, userId, userId, limit).map((row) => ({ ...row, seq: Number(row.seq) }));
  }

  close() { this.db.close(); }
}
