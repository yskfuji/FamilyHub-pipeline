import { shiftMonthKey } from './calendarDate';
import { incomeCategories, monthIncome, monthSummary, percentages, remainingTotal } from './ledger';
import type { Expense, HouseholdMembership, Id } from './types';

/**
 * 家計の画面の集計。どれも渡された記録から計算するので、一覧と合計は必ず一致する。
 * 渡すのは閲覧者に見えている記録で、家族全体の記録とは限らない。
 */

export function monthOverview(expenses: Expense[], month: string) {
  const spending = monthSummary(expenses, month);
  const income = monthIncome(expenses, month);
  return { spending, income, netJpy: income.totalJpy - spending.totalJpy, count: spending.count + income.count };
}

/** 先月と比べた支出の差。先月の支出の記録がなければ比べない。 */
export function monthComparison(expenses: Expense[], month: string) {
  const previousMonth = shiftMonthKey(month, -1);
  const previous = monthSummary(expenses, previousMonth);
  if (previous.count === 0) return { previousMonth, differenceJpy: null };
  return { previousMonth, differenceJpy: monthSummary(expenses, month).totalJpy - previous.totalJpy };
}

/** 収入のうち支出に使った割合。収入の記録がないときは割合を出さない。超えた分は overJpy に入れる。 */
export function balanceOf(spendingJpy: number, incomeJpy: number) {
  const overJpy = Math.max(0, spendingJpy - incomeJpy);
  if (incomeJpy === 0) return { percent: null, leftJpy: 0, overJpy };
  return { percent: Math.floor((spendingJpy / incomeJpy) * 100), leftJpy: Math.max(0, incomeJpy - spendingJpy), overJpy };
}

/** 月の収入の費目別の合計（多い順）。 */
export function incomeBreakdown(expenses: Expense[], month: string) {
  const inMonth = expenses.filter((expense) => expense.kind === 'income' && !expense.deletedAt && expense.incurredOn.startsWith(`${month}-`));
  const totals = incomeCategories
    .map((category) => ({ category, totalJpy: inMonth.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amountJpy, 0) }))
    .filter((item) => item.totalJpy > 0)
    .sort((a, b) => b.totalJpy - a.totalJpy || incomeCategories.indexOf(a.category) - incomeCategories.indexOf(b.category));
  const shares = percentages(totals.map((item) => item.totalJpy));
  return totals.map((item, index) => ({ ...item, percent: shares[index] }));
}

/** 月の支出について、人ごとの支払った額と負担する額。精算は含めない。関わりのない人は出さない。 */
export function memberTotals(expenses: Expense[], month: string, memberships: readonly HouseholdMembership[]) {
  const paid = new Map<Id, number>();
  const burden = new Map<Id, number>();
  const add = (totals: Map<Id, number>, id: Id, amountJpy: number) => totals.set(id, (totals.get(id) ?? 0) + amountJpy);
  for (const expense of expenses) {
    if (expense.kind === 'income' || expense.deletedAt || !expense.incurredOn.startsWith(`${month}-`)) continue;
    add(paid, expense.payerMembershipId, expense.amountJpy);
    for (const share of expense.shares) add(burden, share.membershipId, share.amountJpy);
  }
  const order = memberships.map((member) => member.id);
  const rank = (id: Id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return [...new Set([...paid.keys(), ...burden.keys()])]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((membershipId) => {
      const paidJpy = paid.get(membershipId) ?? 0;
      const burdenJpy = burden.get(membershipId) ?? 0;
      return { membershipId, paidJpy, burdenJpy, differenceJpy: paidJpy - burdenJpy };
    });
}

/** 残りのある記録。月によらず、古いものから並べる。 */
export function openExpenses(expenses: Expense[]) {
  return expenses
    .filter((expense) => !expense.deletedAt && remainingTotal(expense) > 0)
    .sort((a, b) => a.incurredOn.localeCompare(b.incurredOn) || a.id.localeCompare(b.id));
}
