import { memberName, useApp } from '../../app/AppContext';
import { settleAllCopy } from '../../content/ja';
import { StatusBadge, formatYen } from '../../design-system/components';
import type { SettlementBatchRow, SettlementHistoryEntry, SettlementHistoryRow } from '../../domain/ledger';

const at = (value: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));

interface Props {
  /** 記録ごとの行と、まとめた精算の行（groupedSettlementHistory）。支出の詳細では記録ごとの行だけを渡す。 */
  rows: SettlementHistoryRow[];
  showExpense: boolean;
  /** 支出の詳細へのリンクに引き継ぐ、今の画面のクエリ。 */
  search?: string;
  onReverse: (entry: SettlementHistoryEntry) => void;
  onReverseBatch?: (batchId: string) => void;
  busyId: string | null;
}

/** 記録ごとの行にする（支出の詳細の履歴）。 */
export const singleRows = (entries: SettlementHistoryEntry[]): SettlementHistoryRow[] => entries.map((entry) => ({ kind: 'single', entry }));

function SingleRow({ entry, showExpense, search, onReverse, busyId }: { entry: SettlementHistoryEntry } & Omit<Props, 'rows' | 'onReverseBatch'>) {
  const { snapshot, can } = useApp();
  const { record } = entry;
  const reversal = Boolean(entry.reverses);
  return <li className="list-row">
    <span className={`history-mark${reversal ? ' reversal' : ''}`} aria-hidden="true">{reversal ? '↺' : '¥'}</span>
    <div className="row-main">
      <strong>{reversal ? `取り消し（${memberName(snapshot, record.toMembershipId)}さんの精算）` : `${memberName(snapshot, record.fromMembershipId)}さんから${memberName(snapshot, record.toMembershipId)}さんへ`}</strong>
      <span className="meta">{at(record.recordedAt)}{record.batchId ? ` · ${settleAllCopy.partOfBatch}` : ''}{showExpense ? <> · <a data-control-id={`budget.history.expense.${record.id}`} href={`/budget/${entry.expenseId}${search}`} data-link>{entry.expenseTitle}</a></> : null}</span>
    </div>
    <div className="history-side">
      <span className={`amount${reversal ? ' negative' : ''}`}>{reversal ? `−${formatYen(-record.amountJpy)}` : formatYen(record.amountJpy)}</span>
      {entry.reversedBy ? <StatusBadge>取り消し済み</StatusBadge>
        : entry.canReverse && can('expense.settle') ? <button data-control-id={`budget.settlement.reverse.${showExpense ? 'list' : 'detail'}.${record.id}`} className="button" type="button" disabled={busyId !== null} aria-label={`${at(record.recordedAt)}の${formatYen(record.amountJpy)}の精算を取り消す`} onClick={() => onReverse(entry)}>{busyId === record.id ? '取り消し中…' : '取り消す'}</button>
          : null}
    </div>
  </li>;
}

/** まとめた精算の1件（A4-4）。実際に渡した送金と、含めた記録を示し、まとめごと取り消せる。 */
function BatchRow({ row, search, onReverseBatch, busyId }: { row: SettlementBatchRow; search: string; onReverseBatch?: (batchId: string) => void; busyId: string | null }) {
  const { snapshot, can } = useApp();
  const expenses = [...new Map(row.entries.map((entry) => [entry.expenseId, entry.expenseTitle])).entries()];
  const title = row.reversal ? settleAllCopy.batchReversalTitle(expenses.length) : settleAllCopy.batchTitle(expenses.length);
  return <li className="list-row batch-row" data-batch-id={row.batchId}>
    <span className={`history-mark batch${row.reversal ? ' reversal' : ''}`} aria-hidden="true">{row.reversal ? '↺' : '¥'}</span>
    <div className="row-main">
      <strong>{title}</strong>
      <span className="meta">{at(row.recordedAt)} · {settleAllCopy.total(formatYen(row.totalJpy))}</span>
      {!row.reversal && row.transfers.length > 0 && <ul className="batch-transfers" aria-label={settleAllCopy.transfersHeading}>{row.transfers.map((transfer) => <li key={`${transfer.from}-${transfer.to}`}>{settleAllCopy.transfer(memberName(snapshot, transfer.from), memberName(snapshot, transfer.to))} <span className="amount">{formatYen(transfer.amountJpy)}</span></li>)}</ul>}
      <details className="batch-records"><summary>{settleAllCopy.includes}（{expenses.length}件）</summary><ul>{expenses.map(([id, name]) => <li key={id}><a data-control-id={`budget.history.batch-expense.${row.batchId}.${id}`} href={`/budget/${id}${search}`} data-link>{name}</a></li>)}</ul></details>
      {row.partlyReversed && <p className="small muted mb-0">{settleAllCopy.partlyReversed}</p>}
    </div>
    <div className="history-side">
      {row.reversal ? null
        : row.reversed ? <StatusBadge>{settleAllCopy.reversed}</StatusBadge>
          : row.canReverse && onReverseBatch && can('expense.settle') ? <button data-control-id={`budget.settlement.reverse-batch.${row.batchId}`} className="button" type="button" disabled={busyId !== null} aria-label={`${at(row.recordedAt)}の${title}をまとめて取り消す`} onClick={() => onReverseBatch(row.batchId)}>{busyId === `batch:${row.batchId}` ? settleAllCopy.reversing : settleAllCopy.reverse}</button>
            : null}
    </div>
  </li>;
}

/**
 * 精算の履歴。記録は書き換えず、取り消しは反対向きの記録として並べる。
 * 取り消せるのは、まだ取り消していない精算だけ（取り消しの記録そのものは取り消せない）。まとめた精算は1件にまとめる。
 */
export function SettlementHistory({ rows, showExpense, search = '', onReverse, onReverseBatch, busyId }: Props) {
  if (rows.length === 0) return <p className="muted mb-0">精算の記録はまだありません。精算すると、ここに日時と金額が残ります。</p>;
  return <ul className="list history-list">{rows.map((row) => row.kind === 'batch'
    ? <BatchRow key={`${row.batchId}-${row.reversal ? 'r' : 'b'}`} row={row} search={search} onReverseBatch={onReverseBatch} busyId={busyId}/>
    : <SingleRow key={row.entry.record.id} entry={row.entry} showExpense={showExpense} search={search} onReverse={onReverse} busyId={busyId}/>)}</ul>;
}
