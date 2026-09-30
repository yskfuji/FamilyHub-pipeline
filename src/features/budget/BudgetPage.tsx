import { useApp, memberName } from '../../app/AppContext';
import { PageHeader, StatusBadge, formatYen } from '../../design-system/components';
import { CheckIcon, YenIcon } from '../../design-system/icons';

export function BudgetPage() {
  const { snapshot, gateway, refresh, announce } = useApp();
  const total = snapshot.expenses.reduce((sum, expense) => sum + expense.amountJpy, 0);
  const outstanding = snapshot.expenses.reduce((sum, expense) => sum + expense.shares.reduce((part, share) => part + Math.max(0, share.amountJpy - share.settledJpy), 0), 0);
  const settle = async (expenseId: string, amount: number) => {
    const result = await gateway.expenses.recordSettlement(expenseId, amount);
    if (!result.ok) { announce(result.error.message); return; }
    await refresh();
    announce(`${formatYen(amount)}の精算を記録しました。誤りは履歴から取り消せます`);
  };
  return <div className="page">
    <PageHeader eyebrow="Budget & split" title="家計と割り勘" description="金額は1円単位の整数で保存し、負担と精算を別の記録として残します。" action={<button className="button primary" type="button" onClick={() => document.querySelector<HTMLButtonElement>('.quick-create')?.click()}><YenIcon width="18"/>支出を追加</button>}/>
    <div className="grid three">
      <section className="card accent"><span className="meta">9月の記録</span><p className="metric">{formatYen(total)}</p><p className="muted small mb-0">デモデータ3件の合計</p></section>
      <section className="card"><span className="meta">未精算</span><p className="metric">{formatYen(outstanding)}</p><p className="muted small mb-0">相手別内訳を下に表示</p></section>
      <section className="card"><span className="meta">精算済み</span><p className="metric">{formatYen(2920)}</p><p className="muted small mb-0">履歴から確認・取消可能</p></section>
    </div>
    <div className="grid two mt-1">
      <section className="card"><div className="section-head"><div><p className="eyebrow">Category</p><h2>支出の内訳</h2></div><div className="donut" role="img" aria-label="教育24%、交通28%、食費48%"/></div>{[['食費',5840,48],['交通',3360,28],['教育',2860,24]].map(([label,value,width]) => <div key={label} style={{ marginBottom: '.9rem' }}><div className="split"><strong>{label}</strong><span className="meta">{formatYen(Number(value))}</span></div><div className="bar"><span style={{ width: `${width}%` }}/></div></div>)}</section>
      <section className="card"><p className="eyebrow">Balance</p><h2>誰から誰へ</h2><div className="callout"><YenIcon/><div><strong>蓮 → 碧</strong><p className="metric mb-0">{formatYen(1430)}</p><p className="small muted mb-0">学校教材の半分</p></div></div><div className="callout info mt-1"><YenIcon/><div><strong>碧 → 蓮</strong><p className="metric mb-0">{formatYen(1680)}</p><p className="small muted mb-0">交通費の半分</p></div></div></section>
    </div>
    <section className="card mt-1"><div className="section-head"><div><p className="eyebrow">Expenses</p><h2>記録と精算</h2></div><span className="meta">新しい順</span></div><ul className="list">{snapshot.expenses.map((expense) => {
      const due = expense.shares.reduce((sum, share) => sum + Math.max(0, share.amountJpy - share.settledJpy), 0);
      return <li className="list-row" key={expense.id}><span className="avatar" aria-hidden="true">{memberName(snapshot,expense.payerMembershipId).slice(0,1)}</span><div className="row-main"><strong>{expense.title}</strong><span className="meta">{expense.incurredOn} · {memberName(snapshot,expense.payerMembershipId)}が支払 · 合計{formatYen(expense.amountJpy)}</span></div>{due > 0 ? <button className="button" type="button" onClick={() => void settle(expense.id,due)}>残り{formatYen(due)}を精算</button> : <StatusBadge tone="success"><CheckIcon width="14"/>精算済み</StatusBadge>}</li>;
    })}</ul></section>
  </div>;
}
