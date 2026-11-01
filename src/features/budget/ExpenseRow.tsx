import { memberName, useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { StatusBadge, formatDateOnly, formatYen } from '../../design-system/components';
import { CheckIcon, MapPinIcon } from '../../design-system/icons';
import { remainingTotal } from '../../domain/ledger';
import type { Expense } from '../../domain/types';

export const payerLabel = (expense: Pick<Expense, 'kind'>) => (expense.kind === 'income' ? '受け取った人' : '支払った人');

function Status({ expense }: { expense: Expense }) {
  const due = remainingTotal(expense);
  if (expense.kind === 'income') return <StatusBadge tone="success">{ja.expenseKind.income}</StatusBadge>;
  if (due > 0) return <StatusBadge tone="attention">残り{formatYen(due)}</StatusBadge>;
  const shared = expense.shares.some((share) => share.membershipId !== expense.payerMembershipId);
  return shared ? <StatusBadge tone="success"><CheckIcon width="14"/>精算済み</StatusBadge> : null;
}

/** 記録の1行。残りの額に支払った人の分は含まない。 */
export function ExpenseRow({ expense, search, showDate = true }: { expense: Expense; search: string; showDate?: boolean }) {
  const { snapshot } = useApp();
  const payer = memberName(snapshot, expense.payerMembershipId);
  const parts = [...(showDate ? [formatDateOnly(expense.incurredOn)] : []), ja.expenseCategory[expense.category], `${payerLabel(expense)}：${payer}さん`];
  return <li className="list-row">
    <span className="avatar" aria-hidden="true">{payer.slice(0, 1)}</span>
    <div className="row-main">
      <a data-control-id={`budget.expense.open.${expense.id}`} className="row-link" href={`/budget/${expense.id}${search}`} data-link><strong>{expense.title}</strong></a>
      <span className="meta">{parts.join(' · ')}</span>
      {expense.place && <span className="place-chip"><MapPinIcon width="14"/>{expense.place.name}</span>}
    </div>
    <div className="expense-side">
      <span className="amount">{expense.kind === 'income' ? '+' : ''}{formatYen(expense.amountJpy)}</span>
      <Status expense={expense}/>
    </div>
  </li>;
}
