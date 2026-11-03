import { createHash } from 'node:crypto';
import { GENESIS_HASH } from './schema';

/** 監査の記録の1行。audit.db の audit_events と同じ形。 */
export interface ChainRow {
  seq: number;
  id: string;
  at: string;
  household_id: string | null;
  actor_user_id: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  prev_hash: string;
  hash: string;
}

export type ChainFields = Omit<ChainRow, 'seq' | 'prev_hash' | 'hash'>;

export interface Checkpoint { through_seq: number; hash: string; pruned_before: string; pruned_rows: number; at: string }
/** 鎖の外に残した基準点。その番号の行の hash。 */
export interface Anchor { seq: number; hash: string }

/**
 * 正規化した行。項目の並びを固定した JSON の配列にする（文字列・null だけなので表記は1通りに決まる）。
 * seq は入れない。並びは prev_hash のつながりで決まり、seq は場所を示すための番号として使う。
 */
export const canonicalRow = (row: ChainFields) => JSON.stringify([row.id, row.at, row.household_id, row.actor_user_id, row.action, row.target, row.detail]);

/** hash = SHA-256(prev_hash ‖ 正規化した行)。鍵は使わない（鍵を引退させても確かめられるように）。 */
export const chainHash = (prevHash: string, row: ChainFields) => createHash('sha256').update(prevHash).update(canonicalRow(row)).digest('hex');

export type ProblemKind = 'modified' | 'deleted' | 'reordered' | 'inserted' | 'truncated' | 'rewritten' | 'checkpoint';
/** 見つけた食い違い。seq は、どこで見つけたか（行の番号）。 */
export interface ChainProblem { kind: ProblemKind; seq: number; detail: string }

export interface VerifyInput {
  rows: readonly ChainRow[];
  checkpoint: Checkpoint | null;
  anchors: readonly Anchor[];
  /** 直近の分だけを確かめるとき、最初の行の prev_hash を信じて始める。 */
  partial?: boolean;
}

export interface VerifyResult { ok: boolean; checked: number; tailSeq: number; tailHash: string; problems: ChainProblem[] }

/** 運用の記録に残す、prune の行の detail。verify は最後の checkpoint を、この行が鎖の中で裏づけることを確かめる。 */
export const pruneDetail = (checkpoint: Pick<Checkpoint, 'through_seq' | 'hash' | 'pruned_before' | 'pruned_rows'>) => JSON.stringify({ throughSeq: checkpoint.through_seq, hash: checkpoint.hash, before: checkpoint.pruned_before, rows: checkpoint.pruned_rows });
export const PRUNE_ACTION = 'operator.auditPrune';

/**
 * 鎖を先頭から確かめる。改変・削除・並べ替え・挿入・基準点より前の切り捨てを、見つけた行の番号とともに返す。
 * 最後の基準点より後の切り捨ては、鎖だけでは気づけない（残った行はどれも正しくつながっているため）。
 */
export function verifyChain(input: VerifyInput): VerifyResult {
  const { rows, checkpoint, anchors } = input;
  const problems: ChainProblem[] = [];
  const report = (kind: ProblemKind, seq: number, detail: string) => problems.push({ kind, seq, detail });
  const baseSeq = checkpoint?.through_seq ?? 0;
  let expectedPrev = checkpoint?.hash ?? GENESIS_HASH;
  let expectedSeq = baseSeq + 1;
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const live = ordered.filter((row) => row.seq > baseSeq);
  for (const row of ordered.filter((item) => item.seq <= baseSeq)) report('inserted', row.seq, 'a row remains inside the range a checkpoint already covers');
  if (input.partial && live[0]) { expectedPrev = live[0].prev_hash; expectedSeq = live[0].seq; }
  const hashes = new Map(live.map((row, index) => [row.hash, index]));
  const prevs = new Map(live.map((row, index) => [row.prev_hash, index]));
  for (const [index, row] of live.entries()) {
    if (chainHash(row.prev_hash, row) !== row.hash) report('modified', row.seq, 'the row no longer matches its hash');
    if (row.seq > expectedSeq) report('deleted', expectedSeq, `rows ${expectedSeq}..${row.seq - 1} are missing`);
    else if (row.prev_hash !== expectedPrev) {
      const later = (hashes.get(row.prev_hash) ?? -1) > index || (prevs.get(expectedPrev) ?? -1) > index;
      if (later) report('reordered', row.seq, 'the row is linked to a row that comes later');
      else if (index > 0 && row.prev_hash === live[index - 1].prev_hash) report('inserted', live[index - 1].seq, 'the row does not belong to the chain; the next row links past it');
      else report('deleted', row.seq, 'the row before this one is missing');
    }
    expectedPrev = row.hash;
    expectedSeq = row.seq + 1;
  }
  const tail = live.at(-1);
  const tailSeq = tail?.seq ?? baseSeq;
  const tailHash = tail?.hash ?? expectedPrev;
  // 最後の checkpoint は、鎖の中の prune の行が裏づける。消すためだけに置いた checkpoint を見分ける。
  if (checkpoint && !input.partial && !live.some((row) => row.action === PRUNE_ACTION && row.detail === pruneDetail(checkpoint))) {
    report('checkpoint', checkpoint.through_seq, 'no prune record in the chain matches the latest checkpoint');
  }
  const bySeq = new Map(live.map((row) => [row.seq, row]));
  const firstChecked = input.partial ? (live[0]?.seq ?? baseSeq + 1) : baseSeq + 1;
  for (const anchor of [...anchors].sort((a, b) => a.seq - b.seq)) {
    if (anchor.seq === 0) continue;
    if (anchor.seq > tailSeq) { report('truncated', tailSeq + 1, `rows ${tailSeq + 1}..${anchor.seq} were recorded by an anchor but are gone`); break; }
    if (anchor.seq === baseSeq && checkpoint) { if (anchor.hash !== checkpoint.hash) report('rewritten', anchor.seq, 'the checkpoint does not match the anchor'); continue; }
    if (anchor.seq < firstChecked) continue;
    const row = bySeq.get(anchor.seq);
    if (!row) report('deleted', anchor.seq, 'the anchored row is missing');
    else if (row.hash !== anchor.hash) report('rewritten', anchor.seq, 'the anchored row has a different hash');
  }
  problems.sort((a, b) => a.seq - b.seq);
  return { ok: problems.length === 0, checked: live.length, tailSeq, tailHash, problems };
}
