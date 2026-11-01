import { memberName, useApp } from '../../app/AppContext';
import { EmptyState, formatSignedYen, formatYen } from '../../design-system/components';
import { memberTotals } from '../../domain/budgetSummary';
import type { Expense } from '../../domain/types';
import { monthLabel } from './BudgetNav';

/** 月の支出について、人ごとの支払った額・負担する額・その差。 */
export function BudgetMembers({ expenses, month }: { expenses: Expense[]; month: string }) {
  const { snapshot } = useApp();
  const rows = memberTotals(expenses, month, snapshot.memberships);
  if (rows.length === 0) return <div className="mt-1"><EmptyState title="この月の支出はありません">支出を記録すると、人ごとの支払いと負担をここに表示します。</EmptyState></div>;
  const total = (pick: (row: typeof rows[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  return <section className="card mt-1" aria-labelledby="members-title">
    <p className="eyebrow">{monthLabel(month)}</p>
    <h2 id="members-title">メンバー別の支払いと負担</h2>
    <p className="muted small budget-note">差は「支払った額 − 負担する額」です。プラスの人は、負担より多く支払っています。精算は含めていません。</p>
    <div className="ledger-scroll" role="group" aria-labelledby="members-title" tabIndex={0}><table className="ledger-table">
      <thead><tr><th scope="col">人</th><th scope="col">支払った額</th><th scope="col">負担する額</th><th scope="col">差</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.membershipId}><th scope="row">{memberName(snapshot, row.membershipId)}</th><td>{formatYen(row.paidJpy)}</td><td>{formatYen(row.burdenJpy)}</td><td>{formatSignedYen(row.differenceJpy)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">合計</th><td>{formatYen(total((row) => row.paidJpy))}</td><td>{formatYen(total((row) => row.burdenJpy))}</td><td>{formatSignedYen(total((row) => row.differenceJpy))}</td></tr></tfoot>
    </table></div>
  </section>;
}
