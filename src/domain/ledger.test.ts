import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../data/fixtures';
import { categoryBreakdown, monthSummary, settledNet, settlementHistory, simplifiedTransfers, splitShares, unsettledSummary } from './ledger';
import type { Expense } from './types';

const expenses = baseSnapshot.expenses;

describe('ledger', () => {
  it('computes month totals, unsettled amounts and settled net from records', () => {
    expect(monthSummary(expenses, '2026-09')).toEqual({ totalJpy: 12060, count: 3 });
    expect(monthSummary(expenses, '2026-10')).toEqual({ totalJpy: 0, count: 0 });
    expect(unsettledSummary(expenses)).toEqual({ totalJpy: 3110, count: 2 });
    expect(settledNet(expenses)).toBe(2920);
  });

  it('breaks down categories with percentages that add up to 100', () => {
    const breakdown = categoryBreakdown(expenses, '2026-09');
    expect(breakdown.map((item) => item.category)).toEqual(['food', 'transport', 'education']);
    expect(breakdown.reduce((sum, item) => sum + item.percent, 0)).toBe(100);
  });

  it('nets debts between the same two people', () => {
    expect(simplifiedTransfers(expenses)).toEqual([{ from: 'member-aoi', to: 'member-ren', amountJpy: 250 }]);
  });

  it('collapses a chain of debts into fewer transfers and ignores settled shares', () => {
    const owed = (id: string, payer: string, debtor: string, amountJpy: number, settledJpy = 0): Expense => ({ ...expenses[0], id, payerMembershipId: payer, shares: [{ membershipId: debtor, amountJpy, settledJpy }], settlements: [] });
    expect(simplifiedTransfers([owed('e1', 'b', 'a', 1000), owed('e2', 'c', 'b', 1000)])).toEqual([{ from: 'a', to: 'c', amountJpy: 1000 }]);
    expect(simplifiedTransfers([owed('e1', 'b', 'a', 1000, 400)])).toEqual([{ from: 'a', to: 'b', amountJpy: 600 }]);
    expect(simplifiedTransfers([owed('e1', 'b', 'a', 700), owed('e2', 'c', 'a', 300), owed('e3', 'b', 'd', 100)])).toEqual([{ from: 'a', to: 'b', amountJpy: 800 }, { from: 'a', to: 'c', amountJpy: 200 }, { from: 'd', to: 'c', amountJpy: 100 }]);
    expect(simplifiedTransfers([owed('e1', 'b', 'a', 500, 500), { ...owed('e2', 'b', 'a', 500), deletedAt: '2026-09-30T00:00:00+09:00' }])).toEqual([]);
  });

  it('links reversals to the original settlement and only allows reversing live records', () => {
    const expense: Expense = { ...expenses[0], settlements: [
      { id: 's1', amountJpy: 500, fromMembershipId: 'member-ren', toMembershipId: 'member-aoi', recordedAt: '2026-09-30T08:00:00+09:00', reversedAt: '2026-09-30T08:05:00+09:00' },
      { id: 's2', amountJpy: -500, fromMembershipId: 'member-aoi', toMembershipId: 'member-ren', recordedAt: '2026-09-30T08:05:00+09:00', reversalOfSettlementId: 's1' },
    ] };
    const history = settlementHistory([expense]);
    expect(history.map((entry) => entry.record.id)).toEqual(['s2', 's1']);
    expect(history[0]).toMatchObject({ reverses: { id: 's1' }, canReverse: false });
    expect(history[1]).toMatchObject({ reversedBy: { id: 's2' }, canReverse: false });
    expect(settledNet([expense])).toBe(0);
  });

  it('gives the payer their own extra yen as already settled', () => {
    expect(splitShares(1001, 'a', ['a', 'b'])).toEqual([{ membershipId: 'a', amountJpy: 501, settledJpy: 501 }, { membershipId: 'b', amountJpy: 500, settledJpy: 0 }]);
  });
});
