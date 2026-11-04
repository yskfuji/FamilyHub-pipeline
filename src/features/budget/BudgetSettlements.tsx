import { Suspense, lazy, useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { settleAllCopy } from '../../content/ja';
import { EmptyState, formatYen } from '../../design-system/components';
import { YenIcon } from '../../design-system/icons';
import { openExpenses } from '../../domain/budgetSummary';
import { groupedSettlementHistory, settleAllRequest, settledNet, simplifiedTransfers, unsettledSummary, type SettlementHistoryEntry } from '../../domain/ledger';
import type { Expense, SettleAllInput } from '../../domain/types';
import { ExpenseRow } from './ExpenseRow';
import { SettlementHistory } from './SettlementHistory';
import type { ExpenseActions } from './useBudgetActions';

const SettleAllDialog = lazy(async () => ({ default: (await import('./SettleAllDialog')).SettleAllDialog }));

/**
 * 受け渡しのまとめ。「まとめて精算する」は、表示する人が「すべて」のときだけ出す（A4-3）。絞り込み中に示した一覧は家計の全体ではないため。
 */
function Transfers({ expenses, memberFilterActive, actions }: { expenses: Expense[]; memberFilterActive: boolean; actions: ExpenseActions }) {
  const { snapshot, can } = useApp();
  const [confirming, setConfirming] = useState<SettleAllInput | null>(null);
  const transfers = simplifiedTransfers(expenses);
  const request = can('expense.settle') ? settleAllRequest(expenses, { memberFilterActive }) : null;
  return <section className="card mt-1" aria-labelledby="transfers-title">
    <p className="eyebrow">まとめて精算</p>
    <h2 id="transfers-title">誰が誰に渡せば済むか</h2>
    {transfers.length === 0
      ? <p className="muted mb-0">支払いが残っている人はいません。</p>
      : <div className="stack">
        <p className="muted small mb-0">残りのある記録をすべて相殺した金額です。受け渡しのあとは「まとめて精算する」で一度に記録するか、下の記録ごとに精算を残してください。</p>
        {transfers.map((transfer) => <div className="callout" key={`${transfer.from}-${transfer.to}`}><YenIcon/><div><strong>{memberName(snapshot, transfer.from)}さんから{memberName(snapshot, transfer.to)}さんへ</strong><p className="metric mb-0">{formatYen(transfer.amountJpy)}</p></div></div>)}
        {request && <div className="settle-all-action"><button data-control-id="budget.settle-all.open" className="button primary" type="button" disabled={actions.busy !== null} onClick={() => setConfirming(request)}>{settleAllCopy.open}</button></div>}
        {memberFilterActive && can('expense.settle') && <p className="small muted mb-0">{settleAllCopy.filtered}</p>}
      </div>}
    {confirming && <Suspense fallback={null}><SettleAllDialog request={confirming} onClose={() => setConfirming(null)} onDone={actions.settledAll}/></Suspense>}
  </section>;
}

/** 月によらない精算の画面。受け渡しのまとめ、残りのある記録、精算の履歴。 */
export function BudgetSettlements({ expenses, search, onReverse, busyId, memberFilterActive, actions }: { expenses: Expense[]; search: string; onReverse: (entry: SettlementHistoryEntry) => void; busyId: string | null; memberFilterActive: boolean; actions: ExpenseActions }) {
  const { snapshot } = useApp();
  const unsettled = unsettledSummary(expenses);
  const open = openExpenses(expenses);
  return <>
    <div className="grid two budget-tiles">
      <section className="card accent"><span className="meta">未精算</span><p className="metric">{formatYen(unsettled.totalJpy)}</p><p className="muted small mb-0">{unsettled.count > 0 ? `残りのある記録${unsettled.count}件` : 'すべて精算済みです'}</p></section>
      <section className="card"><span className="meta">精算済み</span><p className="metric">{formatYen(settledNet(expenses))}</p><p className="muted small mb-0">取り消した分を除いた合計</p></section>
    </div>
    <Transfers expenses={expenses} memberFilterActive={memberFilterActive} actions={actions}/>
    <section className="card mt-1" aria-labelledby="open-title">
      <div className="section-head"><div><p className="eyebrow">すべての月</p><h2 id="open-title">残りのある記録</h2></div><span className="meta">古い順</span></div>
      {open.length === 0 ? <EmptyState title="残りのある記録はありません">新しい支出を記録すると、ここに表示します。</EmptyState> : <ul className="list">{open.map((expense) => <ExpenseRow expense={expense} search={search} key={expense.id}/>)}</ul>}
    </section>
    <section className="card mt-1" aria-labelledby="history-title">
      <div className="section-head"><div><p className="eyebrow">精算</p><h2 id="history-title">精算の履歴</h2></div><span className="meta">新しい順</span></div>
      <SettlementHistory rows={groupedSettlementHistory(expenses, snapshot.settlementBatches)} showExpense search={search} onReverse={onReverse} onReverseBatch={(batchId) => void actions.reverseBatch(batchId)} busyId={busyId}/>
    </section>
  </>;
}
