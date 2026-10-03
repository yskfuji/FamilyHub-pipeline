import { useApp, memberName } from '../../app/AppContext';
import { PageHeader, StatusBadge, formatDateOnly, formatYen } from '../../design-system/components';
import { CheckIcon, YenIcon } from '../../design-system/icons';
import { useState } from 'react';
import { PlaceAttributionLink } from '../place/PlaceField';

export function BudgetPage() {
  const { snapshot, gateway, refresh, announce, can, requestQuickCreate } = useApp();
  const [lastSettlement, setLastSettlement] = useState<{ expenseId: string; settlementId: string; amount: number } | null>(null);
  const total = snapshot.expenses.reduce((sum, expense) => sum + expense.amountJpy, 0);
  const outstanding = snapshot.expenses.reduce((sum, expense) => sum + expense.shares.reduce((part, share) => part + Math.max(0, share.amountJpy - share.settledJpy), 0), 0);
  const settle = async (expenseId: string, amount: number) => {
    const result = await gateway.expenses.recordSettlement(expenseId, amount);
    if (!result.ok) { announce(result.error.message); return; }
    const record = result.value.settlements.at(-1); if (record) setLastSettlement({ expenseId, settlementId: record.id, amount: record.amountJpy });
    await refresh();
    announce(`${formatYen(amount)}の精算を記録しました。誤りは履歴から取り消せます`);
  };
  const undoSettlement = async () => { if (!lastSettlement) return; const result = await gateway.expenses.reverseSettlement(lastSettlement.expenseId, lastSettlement.settlementId); if (!result.ok) return announce(result.error.message); setLastSettlement(null); await refresh(); announce('精算記録を取り消しました。履歴は残ります'); };
  return <div className="page">
    <PageHeader eyebrow="家計と精算" title="家計と割り勘" description="金額は1円単位で保存し、負担と精算を別の記録として残します。" action={can('expense.create') ? <button data-control-id="budget.expense.create" className="button primary" type="button" onClick={() => requestQuickCreate('expense')}><YenIcon width="18"/>支出を追加</button> : undefined}/>
    {lastSettlement && <div className="callout info" role="status"><CheckIcon/><div><strong>{formatYen(lastSettlement.amount)}の精算を記録しました</strong><p className="small muted mb-0">取り消した場合も履歴は残ります。</p></div><button data-control-id="budget.settlement.undo" className="button" type="button" onClick={() => void undoSettlement()}>精算を取り消す</button></div>}
    <div className="grid three">
      <section className="card accent"><span className="meta">9月の記録</span><p className="metric">{formatYen(total)}</p><p className="muted small mb-0">確認用データ3件の合計</p></section>
      <section className="card"><span className="meta">未精算</span><p className="metric">{formatYen(outstanding)}</p><p className="muted small mb-0">相手別内訳を下に表示</p></section>
      <section className="card"><span className="meta">精算済み</span><p className="metric">{formatYen(2920)}</p><p className="muted small mb-0">履歴の確認と取り消しができます</p></section>
    </div>
    <div className="grid two mt-1">
      <section className="card"><div className="section-head"><div><p className="eyebrow">費目別</p><h2>支出の内訳</h2></div><div className="donut" role="img" aria-label="教育24%、交通28%、食費48%"/></div>{[['食費',5840,48],['交通',3360,28],['教育',2860,24]].map(([label,value,width]) => <div key={label} style={{ marginBottom: '.9rem' }}><div className="split"><strong>{label}</strong><span className="meta">{formatYen(Number(value))}</span></div><div className="bar"><span style={{ width: `${width}%` }}/></div></div>)}</section>
      <section className="card"><p className="eyebrow">未精算の内訳</p><h2>誰にいくら支払うか</h2><div className="callout"><YenIcon/><div><strong>蓮さんから碧さんへ</strong><p className="metric mb-0">{formatYen(1430)}</p><p className="small muted mb-0">学校教材の分担額</p></div></div><div className="callout info mt-1"><YenIcon/><div><strong>碧さんから蓮さんへ</strong><p className="metric mb-0">{formatYen(1680)}</p><p className="small muted mb-0">交通費の分担額</p></div></div></section>
    </div>
    <section className="card mt-1"><div className="section-head"><div><p className="eyebrow">支出</p><h2>記録と精算</h2></div><span className="meta">新しい順</span></div><ul className="list">{snapshot.expenses.map((expense) => {
      const due = expense.shares.reduce((sum, share) => sum + Math.max(0, share.amountJpy - share.settledJpy), 0);
      return <li className="list-row" key={expense.id}><span className="avatar" aria-hidden="true">{memberName(snapshot,expense.payerMembershipId).slice(0,1)}</span><div className="row-main"><strong>{expense.title}</strong><span className="meta">{formatDateOnly(expense.incurredOn)}{expense.place ? ` · ${expense.place.name}` : ''} · 支払った人：{memberName(snapshot,expense.payerMembershipId)}さん · 合計{formatYen(expense.amountJpy)}</span></div>{due > 0 && can('expense.settle') ? <button data-control-id={`budget.settlement.record.${expense.id}`} className="button" type="button" onClick={() => void settle(expense.id,due)}>残り{formatYen(due)}を精算</button> : <StatusBadge tone={due > 0 ? 'attention' : 'success'}>{due > 0 ? '未精算' : <><CheckIcon width="14"/>精算済み</>}</StatusBadge>}</li>;
    })}</ul>{snapshot.expenses.some((expense) => expense.place?.provenance) && <PlaceAttributionLink where="budget"/>}</section>
  </div>;
}
