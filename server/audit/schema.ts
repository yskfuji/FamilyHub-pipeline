/**
 * 監査の記録のファイル（audit.db）のスキーマ。本体の DB とは別のファイルに置き、別の接続で開く。
 * 変更は末尾に足す。適用済みのものは書き換えない。
 *
 * trigger の役目:
 * - audit_events は追記だけ。UPDATE はいつも断る。
 * - DELETE は、checkpoint が覆う行（seq <= 最後の checkpoint の through_seq）だけを通す。
 *   checkpoint を書くのは `audit prune` の処理だけで、checkpoint は鎖にある行の hash と一致しなければ書けない。
 *   つまり、行を消す道は「checkpoint を残してから、その手前までを消す」1つだけになる。
 * - 追記は、末尾の hash と次の番号を引き継ぐ行だけを受け付ける（鎖が分かれないことを DB でも確かめる）。
 * - checkpoint は変えられず、消せない。
 * trigger は同じファイルへ書ける人には外せる。守りの境界ではなく、うっかりと手抜きの改ざんを止める柵。
 * 気づく仕組みの中心は、外に残す基準点（server/audit/store.ts の anchor）にある。
 */
export const GENESIS_HASH = '0'.repeat(64);

export const auditMigrations: readonly string[] = [
  `
  CREATE TABLE audit_events (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    at TEXT NOT NULL,
    household_id TEXT,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE INDEX audit_events_household ON audit_events(household_id, seq);
  CREATE INDEX audit_events_actor ON audit_events(actor_user_id, seq);
  CREATE TABLE audit_checkpoints (
    seq INTEGER PRIMARY KEY,
    through_seq INTEGER NOT NULL,
    hash TEXT NOT NULL,
    pruned_before TEXT NOT NULL,
    pruned_rows INTEGER NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
  CREATE TRIGGER audit_events_prune_only BEFORE DELETE ON audit_events
  WHEN OLD.seq > COALESCE((SELECT max(through_seq) FROM audit_checkpoints), 0)
  BEGIN SELECT RAISE(ABORT, 'audit_events rows are removed only by audit prune, after a checkpoint'); END;
  CREATE TRIGGER audit_events_extend_tail BEFORE INSERT ON audit_events
  WHEN NEW.seq IS NOT COALESCE((SELECT max(seq) FROM audit_events), (SELECT max(through_seq) FROM audit_checkpoints), 0) + 1
    OR NEW.prev_hash IS NOT COALESCE((SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1), (SELECT hash FROM audit_checkpoints ORDER BY through_seq DESC LIMIT 1), '0000000000000000000000000000000000000000000000000000000000000000')
  BEGIN SELECT RAISE(ABORT, 'audit_events must extend the tail of the chain'); END;
  CREATE TRIGGER audit_checkpoints_no_update BEFORE UPDATE ON audit_checkpoints
  BEGIN SELECT RAISE(ABORT, 'audit_checkpoints is append-only'); END;
  CREATE TRIGGER audit_checkpoints_no_delete BEFORE DELETE ON audit_checkpoints
  BEGIN SELECT RAISE(ABORT, 'audit_checkpoints is append-only'); END;
  CREATE TRIGGER audit_checkpoints_match_chain BEFORE INSERT ON audit_checkpoints
  WHEN NEW.hash IS NOT (SELECT hash FROM audit_events WHERE seq = NEW.through_seq)
    OR NEW.through_seq <= COALESCE((SELECT max(through_seq) FROM audit_checkpoints), 0)
  BEGIN SELECT RAISE(ABORT, 'a checkpoint must name a row of the chain past the previous checkpoint'); END;
  `,
];
