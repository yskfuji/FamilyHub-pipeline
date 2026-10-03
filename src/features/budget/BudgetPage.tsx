import { useRef, useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { detailId, useCloseTo } from '../../app/router';
import { DetailNotFound, EmptyState, PageHeader, StatusBadge, formatDateOnly, formatYen } from '../../design-system/components';
import { CheckIcon, MapPinIcon, YenIcon } from '../../design-system/icons';
import { ja } from '../../content/ja';
import { monthKeyFromRfc3339 } from '../../domain/calendarDate';
import { categoryBreakdown, monthSummary, remainingTotal, settledNet, settlementHistory, unsettledSummary, whoOwesWhom, type SettlementHistoryEntry } from '../../domain/ledger';
import type { Expense } from '../../domain/types';
import type { ExpenseUpdateInput } from '../../domain/schemas';
import { PlaceAttributionLink } from '../place/PlaceField';
import { ExpenseDetail, type ExpenseActions } from './ExpenseDetail';
import { SettlementHistory } from './SettlementHistory';

type Undo = { kind: 'settlement'; entry: SettlementHistoryEntry; amountJpy: number } | { kind: 'deleted'; expense: Expense };

export function BudgetPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce, can, requestQuickCreate } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const close = useCloseTo('/budget');
  const monthKey = monthKeyFromRfc3339(snapshot.context.asOf);
  const [year, month] = monthKey.split('-').map(Number);
  const expenses = [...snapshot.expenses].sort((a, b) => b.incurredOn.localeCompare(a.incurredOn) || b.id.localeCompare(a.id));
  const activeId = detailId(path, '/budget');
  const active = expenses.find((expense) => expense.id === activeId);
  const thisMonth = monthSummary(expenses, monthKey);
  const unsettled = unsettledSummary(expenses);
  const settled = settledNet(expenses);
  const categories = categoryBreakdown(expenses, monthKey);
  const debts = whoOwesWhom(expenses);
  const history = settlementHistory(expenses);
  const hasProvenance = expenses.some((expense) => expense.place?.provenance);

  const run = async <T,>(key: string, operation: () => Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>, onSuccess: (value: T) => void | Promise<void>) => {
    if (busy) return;
    setBusy(key);
    const result = await operation();
    if (!result.ok) { setBusy(null); announce(result.error.message); return; }
    await onSuccess(result.value);
    await refresh();
    setBusy(null);
  };

  const actions: ExpenseActions = {
    busy,
    settle: (expense, fromMembershipId, amountJpy) => run(`settle:${expense.id}`, () => gateway.expenses.recordSettlement(expense.id, fromMembershipId, amountJpy), (updated) => {
      const record = updated.settlements.at(-1);
      if (!record) return;
      setUndo({ kind: 'settlement', entry: { expenseId: updated.id, expenseTitle: updated.title, record, canReverse: true }, amountJpy: record.amountJpy });
      announce(`${memberName(snapshot, fromMembershipId)}さんの${formatYen(record.amountJpy)}の精算を記録しました。精算の履歴から取り消せます。`);
    }),
    reverse: (entry) => run(entry.record.id, () => gateway.expenses.reverseSettlement(entry.expenseId, entry.record.id), () => {
      if (undo?.kind === 'settlement' && undo.entry.record.id === entry.record.id) setUndo(null);
      announce(`${formatYen(entry.record.amountJpy)}の精算を取り消しました。元の記録と取り消しの記録は履歴に残ります。`);
    }),
    update: async (expense, input: ExpenseUpdateInput) => {
      let message: string | null = null;
      await run(`update:${expense.id}`, async () => {
        const result = await gateway.expenses.updateExpense(expense.id, input, expense.version);
        if (!result.ok) message = result.error.message;
        return result;
      }, () => announce('支出を更新しました。'));
      return message;
    },
    remove: (expense) => run(`delete:${expense.id}`, () => gateway.expenses.deleteExpense(expense.id, expense.version), () => {
      setUndo({ kind: 'deleted', expense });
      close();
      announce(`「${expense.title}」を削除しました。7日以内なら元に戻せます。`);
    }),
  };

  const restore = (expense: Expense) => run(`restore:${expense.id}`, () => gateway.expenses.restoreExpense(expense.id), (value) => { setUndo(null); announce(`「${value.title}」を元に戻しました。`); });
  const jumpToHistory = () => { historyHeading.current?.scrollIntoView({ block: 'start' }); historyHeading.current?.focus(); };

  return <div className="page">
    <PageHeader eyebrow="家計と精算" title="家計と割り勘" description="金額は1円単位で保存し、負担と精算を別の記録として残します。" action={can('expense.create') ? <button data-control-id="budget.expense.create" className="button primary" type="button" onClick={() => requestQuickCreate('expense')}><YenIcon width="18"/>支出を追加</button> : undefined}/>
    {undo?.kind === 'settlement' && <div className="callout info" role="status"><CheckIcon/><div><strong>{formatYen(undo.amountJpy)}の精算を記録しました</strong><p className="small muted mb-0">取り消しても、元の記録と取り消しの記録は履歴に残ります。</p></div><button data-control-id="budget.settlement.undo" className="button" type="button" disabled={busy !== null} onClick={() => void actions.reverse(undo.entry)}>精算を取り消す</button></div>}
    {undo?.kind === 'deleted' && <div className="callout info" role="status"><CheckIcon/><div><strong>「{undo.expense.title}」を削除しました</strong><p className="small muted mb-0">7日以内なら元に戻せます。</p></div><button data-control-id="budget.expense.restore" className="button" type="button" disabled={busy !== null} onClick={() => void restore(undo.expense)}>{ja.actions.restore}</button></div>}
    {activeId && !active && <DetailNotFound what="支出" feature="budget" backHref="/budget"/>}
    <div className="grid three">
      <section className="card accent"><span className="meta">{month}月の記録</span><p className="metric">{formatYen(thisMonth.totalJpy)}</p><p className="muted small mb-0">{year}年{month}月の支出{thisMonth.count}件の合計</p></section>
      <section className="card"><span className="meta">未精算</span><p className="metric">{formatYen(unsettled.totalJpy)}</p><p className="muted small mb-0">{unsettled.count > 0 ? `支出${unsettled.count}件。誰にいくらかは下に表示` : 'すべて精算済みです'}</p></section>
      <section className="card"><span className="meta">精算済み</span><p className="metric">{formatYen(settled)}</p><button data-control-id="budget.history.jump" className="button mt-1" type="button" onClick={jumpToHistory}>精算の履歴を見る</button></section>
    </div>
    <div className="grid two mt-1">
      <section className="card" aria-labelledby="category-title"><p className="eyebrow">費目別</p><h2 id="category-title">{month}月の支出の内訳</h2>
        {categories.length === 0 ? <p className="muted mb-0">{month}月の支出はまだありません。</p> : <ul className="category-list">{categories.map((item) => <li key={item.category}>
          <div className="split"><strong>{ja.expenseCategory[item.category]}</strong><span className="amount">{formatYen(item.totalJpy)}<span className="muted">（{item.percent}%）</span></span></div>
          <div className="bar" aria-hidden="true"><span style={{ width: `${item.percent}%` }}/></div>
        </li>)}</ul>}
      </section>
      <section className="card" aria-labelledby="debt-title"><p className="eyebrow">未精算の内訳</p><h2 id="debt-title">誰にいくら支払うか</h2>
        {debts.length === 0 ? <p className="muted mb-0">支払いが残っている人はいません。</p> : <div className="stack">{debts.map((debt) => <div className="callout" key={`${debt.from}-${debt.to}`}><YenIcon/><div><strong>{memberName(snapshot, debt.from)}さんから{memberName(snapshot, debt.to)}さんへ</strong><p className="metric mb-0">{formatYen(debt.amountJpy)}</p><p className="small muted mb-0">{debt.expenseIds.map((id) => expenses.find((expense) => expense.id === id)?.title).filter(Boolean).join('・')}の負担から計算（相殺済み）</p></div></div>)}</div>}
      </section>
    </div>
    <section className="card mt-1" aria-labelledby="expenses-title"><div className="section-head"><div><p className="eyebrow">支出</p><h2 id="expenses-title">記録と精算</h2></div><span className="meta">日付の新しい順</span></div>
      {expenses.length === 0 ? <EmptyState title="まだ支出がありません">「支出を追加」から記録すると、ここに一覧と精算の状態を表示します。</EmptyState> : <ul className="list">{expenses.map((expense) => {
        const due = remainingTotal(expense);
        return <li className="list-row" key={expense.id}>
          <span className="avatar" aria-hidden="true">{memberName(snapshot, expense.payerMembershipId).slice(0, 1)}</span>
          <div className="row-main">
            <a data-control-id={`budget.expense.open.${expense.id}`} className="row-link" href={`/budget/${expense.id}`} data-link><strong>{expense.title}</strong></a>
            <span className="meta">{formatDateOnly(expense.incurredOn)} · {ja.expenseCategory[expense.category]} · 支払った人：{memberName(snapshot, expense.payerMembershipId)}さん · 合計{formatYen(expense.amountJpy)}</span>
            {expense.place && <span className="place-chip"><MapPinIcon width="14"/>{expense.place.name}</span>}
          </div>
          <StatusBadge tone={due > 0 ? 'attention' : 'success'}>{due > 0 ? `残り${formatYen(due)}` : <><CheckIcon width="14"/>精算済み</>}</StatusBadge>
        </li>;
      })}</ul>}
      {hasProvenance && <PlaceAttributionLink where="budget"/>}
    </section>
    <section className="card mt-1" aria-labelledby="history-title"><div className="section-head"><div><p className="eyebrow">精算</p><h2 id="history-title" ref={historyHeading} tabIndex={-1}>精算の履歴</h2></div><span className="meta">新しい順</span></div>
      <SettlementHistory entries={history} showExpense onReverse={(entry) => void actions.reverse(entry)} busyId={busy}/>
    </section>
    {active && <ExpenseDetail expense={active} onClose={close} actions={actions}/>}
  </div>;
}
