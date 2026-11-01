import { memberName, useApp } from '../../app/AppContext';
import { EmptyState, formatYen } from '../../design-system/components';
import { YenIcon } from '../../design-system/icons';
import { openExpenses } from '../../domain/budgetSummary';
import { settledNet, settlementHistory, simplifiedTransfers, unsettledSummary, type SettlementHistoryEntry } from '../../domain/ledger';
import type { Expense } from '../../domain/types';
import { ExpenseRow } from './ExpenseRow';
import { SettlementHistory } from './SettlementHistory';

function Transfers({ expenses }: { expenses: Expense[] }) {
  const { snapshot } = useApp();
  const transfers = simplifiedTransfers(expenses);
  return <section className="card mt-1" aria-labelledby="transfers-title">
    <p className="eyebrow">まとめて精算</p>
    <h2 id="transfers-title">誰が誰に渡せば済むか</h2>
    {transfers.length === 0
      ? <p className="muted mb-0">支払いが残っている人はいません。</p>
      : <div className="stack">
        <p className="muted small mb-0">残りのある記録をすべて相殺した金額です。受け渡しのあとは、下の記録ごとに精算を残してください。</p>
        {transfers.map((transfer) => <div className="callout" key={`${transfer.from}-${transfer.to}`}><YenIcon/><div><strong>{memberName(snapshot, transfer.from)}さんから{memberName(snapshot, transfer.to)}さんへ</strong><p className="metric mb-0">{formatYen(transfer.amountJpy)}</p></div></div>)}
      </div>}
  </section>;
}

/** 月によらない精算の画面。受け渡しのまとめ、残りのある記録、精算の履歴。 */
export function BudgetSettlements({ expenses, search, onReverse, busyId }: { expenses: Expense[]; search: string; onReverse: (entry: SettlementHistoryEntry) => void; busyId: string | null }) {
  const unsettled = unsettledSummary(expenses);
  const open = openExpenses(expenses);
  return <>
    <div className="grid two budget-tiles">
      <section className="card accent"><span className="meta">未精算</span><p className="metric">{formatYen(unsettled.totalJpy)}</p><p className="muted small mb-0">{unsettled.count > 0 ? `残りのある記録${unsettled.count}件` : 'すべて精算済みです'}</p></section>
      <section className="card"><span className="meta">精算済み</span><p className="metric">{formatYen(settledNet(expenses))}</p><p className="muted small mb-0">取り消した分を除いた合計</p></section>
    </div>
    <Transfers expenses={expenses}/>
    <section className="card mt-1" aria-labelledby="open-title">
      <div className="section-head"><div><p className="eyebrow">すべての月</p><h2 id="open-title">残りのある記録</h2></div><span className="meta">古い順</span></div>
      {open.length === 0 ? <EmptyState title="残りのある記録はありません">新しい支出を記録すると、ここに表示します。</EmptyState> : <ul className="list">{open.map((expense) => <ExpenseRow expense={expense} search={search} key={expense.id}/>)}</ul>}
    </section>
    <section className="card mt-1" aria-labelledby="history-title">
      <div className="section-head"><div><p className="eyebrow">精算</p><h2 id="history-title">精算の履歴</h2></div><span className="meta">新しい順</span></div>
      <SettlementHistory entries={settlementHistory(expenses)} showExpense search={search} onReverse={onReverse} busyId={busyId}/>
    </section>
  </>;
}
