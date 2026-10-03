import { memberName, useApp } from '../../app/AppContext';
import { StatusBadge, formatYen } from '../../design-system/components';
import type { SettlementHistoryEntry } from '../../domain/ledger';

const at = (value: string) => new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(new Date(value));

/**
 * 精算の履歴。記録は書き換えず、取り消しは反対向きの記録として並べる。
 * 取り消せるのは、まだ取り消していない精算だけ（取り消しの記録そのものは取り消せない）。
 */
export function SettlementHistory({ entries, showExpense, onReverse, busyId }: { entries: SettlementHistoryEntry[]; showExpense: boolean; onReverse: (entry: SettlementHistoryEntry) => void; busyId: string | null }) {
  const { snapshot, can } = useApp();
  if (entries.length === 0) return <p className="muted mb-0">精算の記録はまだありません。精算すると、ここに日時と金額が残ります。</p>;
  return <ul className="list history-list">{entries.map((entry) => {
    const { record } = entry;
    const reversal = Boolean(entry.reverses);
    return <li className="list-row" key={record.id}>
      <span className={`history-mark${reversal ? ' reversal' : ''}`} aria-hidden="true">{reversal ? '↺' : '¥'}</span>
      <div className="row-main">
        <strong>{reversal ? `取り消し（${memberName(snapshot, record.toMembershipId)}さんの精算）` : `${memberName(snapshot, record.fromMembershipId)}さんから${memberName(snapshot, record.toMembershipId)}さんへ`}</strong>
        <span className="meta">{at(record.recordedAt)}{showExpense ? <> · <a data-control-id={`budget.history.expense.${record.id}`} href={`/budget/${entry.expenseId}`} data-link>{entry.expenseTitle}</a></> : null}</span>
      </div>
      <div className="history-side">
        <span className={`amount${reversal ? ' negative' : ''}`}>{reversal ? `−${formatYen(-record.amountJpy)}` : formatYen(record.amountJpy)}</span>
        {entry.reversedBy ? <StatusBadge>取り消し済み</StatusBadge>
          : entry.canReverse && can('expense.settle') ? <button data-control-id={`budget.settlement.reverse.${record.id}`} className="button" type="button" disabled={busyId !== null} aria-label={`${at(record.recordedAt)}の${formatYen(record.amountJpy)}の精算を取り消す`} onClick={() => onReverse(entry)}>{busyId === record.id ? '取り消し中…' : '取り消す'}</button>
            : null}
      </div>
    </li>;
  })}</ul>;
}
