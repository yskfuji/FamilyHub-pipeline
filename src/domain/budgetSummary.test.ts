import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../data/fixtures';
import { balanceOf, incomeBreakdown, memberTotals, monthComparison, monthOverview, openExpenses } from './budgetSummary';
import type { Expense } from './types';

const expenses = baseSnapshot.expenses;
const memberships = baseSnapshot.memberships;

describe('budget summary', () => {
  it('keeps spending and income apart and nets them', () => {
    expect(monthOverview(expenses, '2026-09')).toEqual({ spending: { totalJpy: 12060, count: 3 }, income: { totalJpy: 320000, count: 1 }, netJpy: 307940, count: 4 });
    expect(monthOverview(expenses, '2026-10')).toEqual({ spending: { totalJpy: 0, count: 0 }, income: { totalJpy: 0, count: 0 }, netJpy: 0, count: 0 });
  });

  it('compares with the previous month only when that month has spending', () => {
    expect(monthComparison(expenses, '2026-09')).toEqual({ previousMonth: '2026-08', differenceJpy: 2260 });
    expect(monthComparison(expenses, '2026-10')).toEqual({ previousMonth: '2026-09', differenceJpy: -12060 });
    expect(monthComparison(expenses, '2026-08')).toEqual({ previousMonth: '2026-07', differenceJpy: null });
  });

  it('crosses the year when comparing January', () => {
    expect(monthComparison(expenses, '2027-01').previousMonth).toBe('2026-12');
  });

  it('describes the balance without rounding up to a limit that was not reached', () => {
    expect(balanceOf(250, 1000)).toEqual({ percent: 25, leftJpy: 750, overJpy: 0 });
    expect(balanceOf(999, 1000)).toEqual({ percent: 99, leftJpy: 1, overJpy: 0 });
    expect(balanceOf(1500, 1000)).toEqual({ percent: 150, leftJpy: 0, overJpy: 500 });
    expect(balanceOf(1500, 0)).toEqual({ percent: null, leftJpy: 0, overJpy: 1500 });
    expect(balanceOf(0, 0)).toEqual({ percent: null, leftJpy: 0, overJpy: 0 });
  });

  it('breaks income down with percentages that add up to 100', () => {
    const items: Expense[] = [...expenses, { ...expenses[0], id: 'side', kind: 'income', category: 'income_side', amountJpy: 80000, incurredOn: '2026-09-01' }];
    expect(incomeBreakdown(items, '2026-09')).toEqual([{ category: 'income_salary', totalJpy: 320000, percent: 80 }, { category: 'income_side', totalJpy: 80000, percent: 20 }]);
    expect(incomeBreakdown(items, '2026-08')).toEqual([]);
  });

  it('adds up paid and burden per member, and the differences cancel out', () => {
    const rows = memberTotals(expenses, '2026-09', memberships);
    expect(rows).toEqual([
      { membershipId: 'member-aoi', paidJpy: 8700, burdenJpy: 6030, differenceJpy: 2670 },
      { membershipId: 'member-ren', paidJpy: 3360, burdenJpy: 6030, differenceJpy: -2670 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.differenceJpy, 0)).toBe(0);
  });

  it('leaves income, other months and deleted records out of member totals', () => {
    expect(memberTotals(expenses, '2026-10', memberships)).toEqual([]);
    expect(memberTotals([{ ...expenses[0], deletedAt: '2026-09-30T00:00:00+09:00' }], '2026-09', memberships)).toEqual([]);
  });

  it('lists open records across all months, oldest first', () => {
    const old: Expense = { ...expenses[0], id: 'old', incurredOn: '2025-01-01' };
    expect(openExpenses([...expenses, old]).map((item) => item.id)).toEqual(['old', 'expense-train', 'expense-books']);
    expect(openExpenses([{ ...old, deletedAt: '2026-09-30T00:00:00+09:00' }])).toEqual([]);
  });
});
