import { describe, expect, it } from 'vitest';
import { baseSnapshot, seededSnapshot } from '../data/fixtures';
import { canSeeExpense } from '../authz/policy';
import { budgetTrend, trendIsDrawable } from './budgetTrend';
import { monthOverview } from './budgetSummary';
import { monthKeyFromRfc3339 } from './calendarDate';
import { expenseInvolves, inScope } from './memberScope';
import type { Expense, ViewerContext } from './types';

const base = baseSnapshot.expenses[0];
const spend = (id: string, incurredOn: Expense['incurredOn'], amountJpy: number, extra: Partial<Expense> = {}): Expense => ({ ...base, id, title: id, kind: 'expense', category: 'food', incurredOn, amountJpy, shares: [], settlements: [], deletedAt: undefined, ...extra });
const earn = (id: string, incurredOn: Expense['incurredOn'], amountJpy: number) => spend(id, incurredOn, amountJpy, { kind: 'income', category: 'income_salary' });

describe('six-month budget trend', () => {
  it('lists six months oldest first and ends at the given month', () => {
    const trend = budgetTrend(baseSnapshot.expenses, '2026-09');
    expect(trend.months.map((month) => month.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(trend.months.at(-1)).toEqual({ month: '2026-09', spendingJpy: 12060, incomeJpy: 320000, hasRecords: true });
    expect(trend.months.at(-2)).toEqual({ month: '2026-08', spendingJpy: 9800, incomeJpy: 0, hasRecords: true });
  });

  it('shows months without records as zero, not as a gap', () => {
    const trend = budgetTrend(baseSnapshot.expenses, '2026-09');
    expect(trend.months).toHaveLength(6);
    expect(trend.months[0]).toEqual({ month: '2026-04', spendingJpy: 0, incomeJpy: 0, hasRecords: false });
    expect(trend.monthsWithRecords).toBe(2);
    expect(trendIsDrawable(trend)).toBe(true);
  });

  it('puts the last and first day of a month on either side of the boundary', () => {
    const trend = budgetTrend([spend('end', '2026-10-31', 1000), spend('start', '2026-11-01', 2000), spend('eve', '2026-12-31', 400), spend('new-year', '2027-01-01', 300)], '2027-01');
    const of = (month: string) => trend.months.find((item) => item.month === month)?.spendingJpy;
    expect(of('2026-10')).toBe(1000);
    expect(of('2026-11')).toBe(2000);
    expect(of('2026-12')).toBe(400);
    expect(of('2027-01')).toBe(300);
    expect(trend.months[0].month).toBe('2026-08');
  });

  it('reads the current month in the household time zone, not in UTC', () => {
    // 2026-10-31T15:30Z is 00:30 on 1 November in Tokyo. A record made then is dated 2026-11-01 and belongs to November.
    const current = monthKeyFromRfc3339('2026-10-31T15:30:00Z');
    expect(current).toBe('2026-11');
    const trend = budgetTrend([spend('midnight', '2026-11-01', 500)], current);
    expect(trend.months.at(-1)).toMatchObject({ month: '2026-11', spendingJpy: 500 });
    expect(trend.months.at(-2)).toMatchObject({ month: '2026-10', spendingJpy: 0 });
  });

  it('leaves out deleted records and keeps income apart from spending', () => {
    const trend = budgetTrend([spend('kept', '2026-09-02', 700), spend('gone', '2026-09-03', 9000, { deletedAt: '2026-09-04T09:00:00+09:00' }), earn('pay', '2026-09-25', 5000)], '2026-09');
    expect(trend.months.at(-1)).toEqual({ month: '2026-09', spendingJpy: 700, incomeJpy: 5000, hasRecords: true });
    expect(trend.showIncome).toBe(true);
  });

  it('hides income when there is none in the window, and is not drawable with a single month', () => {
    const trend = budgetTrend([spend('only', '2026-09-02', 700)], '2026-09');
    expect(trend.showIncome).toBe(false);
    expect(trend.monthsWithRecords).toBe(1);
    expect(trendIsDrawable(trend)).toBe(false);
    expect(trendIsDrawable(budgetTrend([], '2026-09'))).toBe(false);
  });

  it('agrees with the month totals for the records the viewer can see, after the member filter', () => {
    const snapshot = seededSnapshot();
    const viewer: ViewerContext = { ...snapshot.viewer, membershipId: 'member-aoi' };
    const visible = snapshot.expenses.filter((expense) => canSeeExpense(viewer, expense));
    expect(visible.some((expense) => expense.id === 'expense-ren-private')).toBe(false);
    for (const memberId of [null, 'member-aoi', 'member-ren']) {
      const scoped = inScope(visible, memberId, expenseInvolves);
      for (const month of budgetTrend(scoped, '2026-09').months) {
        const overview = monthOverview(scoped, month.month);
        expect([month.spendingJpy, month.incomeJpy]).toEqual([overview.spending.totalJpy, overview.income.totalJpy]);
      }
    }
    // 蓮さんにだけ見える支出は、碧さんの推移に入らない。
    const all = budgetTrend(snapshot.expenses, '2026-09').months.at(-1)!.spendingJpy;
    expect(budgetTrend(visible, '2026-09').months.at(-1)!.spendingJpy).toBe(all - 3000);
  });
});
