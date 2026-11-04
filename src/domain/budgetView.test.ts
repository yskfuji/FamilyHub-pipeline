import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../data/fixtures';
import { budgetRange, budgetSearch, budgetSorts, filterLedger, latestBudgetMonth, ledgerGroups, monthChange, monthRange, readBudgetLocation, sortLedger } from './budgetView';
import type { Expense } from './types';

const expenses = baseSnapshot.expenses;
const order = baseSnapshot.memberships.map((member) => member.id);
const titles = (items: Expense[]) => items.map((item) => item.id);
const read = (search: string) => readBudgetLocation(search, '2026-09', '2026-09');

describe('budget location', () => {
  it('falls back to the defaults for anything it does not know', () => {
    expect(read('')).toEqual({ view: 'overview', month: '2026-09', period: 'month', category: null, sort: 'date-new', from: null, to: null });
    expect(read('?view=charts&month=2026-13&period=year&category=rent&sort=name&from=2026-02-31&to=x')).toEqual(read(''));
  });

  it('reads every value and refuses months after the last one', () => {
    expect(read('?view=list&month=2026-08&period=custom&category=income_salary&sort=payer&from=2026-08-01&to=2026-08-31')).toEqual({ view: 'list', month: '2026-08', period: 'custom', category: 'income_salary', sort: 'payer', from: '2026-08-01', to: '2026-08-31' });
    expect(read('?month=2026-10').month).toBe('2026-09');
    expect(readBudgetLocation('?month=2026-10', '2026-09', '2026-10').month).toBe('2026-10');
  });

  it('keeps future months reachable only when a record is dated there', () => {
    expect(latestBudgetMonth(expenses, '2026-09')).toBe('2026-09');
    expect(latestBudgetMonth([{ ...expenses[0], incurredOn: '2026-12-01' }], '2026-09')).toBe('2026-12');
  });

  it('leaves defaults out of the URL and keeps unrelated parameters', () => {
    expect(budgetSearch('?actor=member-ren', { view: 'list', sort: 'payer' }, '2026-09')).toBe('?actor=member-ren&view=list&sort=payer');
    expect(budgetSearch('?view=list&month=2026-08', { view: 'overview', month: '2026-09' }, '2026-09')).toBe('');
    expect(budgetSearch('?category=food', { category: null }, '2026-09')).toBe('');
    expect(budgetSearch('?category=food', { view: 'list' }, '2026-09')).toBe('?category=food&view=list');
  });

  it('drops the week and the dates when the month changes, but not the category', () => {
    expect(budgetSearch('?period=custom&from=2026-09-01&to=2026-09-02&category=food', monthChange('2026-08'), '2026-09')).toBe('?category=food&month=2026-08');
  });
});

describe('budget range', () => {
  it('knows the length of each month, including leap years', () => {
    expect(monthRange('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('uses the Sunday-based week holding today, cut to the month', () => {
    expect(budgetRange({ month: '2026-09', period: 'week', from: null, to: null }, '2026-09-30')).toEqual({ start: '2026-09-27', end: '2026-09-30' });
    expect(budgetRange({ month: '2026-09', period: 'week', from: null, to: null }, '2026-09-16')).toEqual({ start: '2026-09-13', end: '2026-09-19' });
  });

  it('uses the first week for any other month', () => {
    expect(budgetRange({ month: '2026-08', period: 'week', from: null, to: null }, '2026-09-30')).toEqual({ start: '2026-08-01', end: '2026-08-01' });
  });

  it('orders a custom range, may span months, and needs both dates', () => {
    expect(budgetRange({ month: '2026-09', period: 'custom', from: '2026-09-10', to: '2026-08-20' }, '2026-09-30')).toEqual({ start: '2026-08-20', end: '2026-09-10' });
    expect(budgetRange({ month: '2026-09', period: 'custom', from: '2026-09-10', to: null }, '2026-09-30')).toEqual(monthRange('2026-09'));
  });
});

describe('ledger list', () => {
  const september = monthRange('2026-09');

  it('filters by range and category, with both range ends included', () => {
    expect(titles(filterLedger(expenses, { start: '2026-09-26', end: '2026-09-27' }, null)).sort()).toEqual(['expense-groceries', 'expense-train']);
    expect(titles(filterLedger(expenses, september, 'food'))).toEqual(['expense-groceries']);
    expect(titles(filterLedger(expenses, september, 'income_salary'))).toEqual(['income-salary']);
  });

  it('has six sort orders, with stable ties', () => {
    const inMonth = filterLedger(expenses, september, null);
    expect(budgetSorts).toHaveLength(6);
    expect(titles(sortLedger(inMonth, 'date-new', order))).toEqual(['expense-books', 'expense-train', 'expense-groceries', 'income-salary']);
    expect(titles(sortLedger(inMonth, 'date-old', order))).toEqual(['income-salary', 'expense-groceries', 'expense-train', 'expense-books']);
    expect(titles(sortLedger(inMonth, 'amount-high', order))).toEqual(['income-salary', 'expense-groceries', 'expense-train', 'expense-books']);
    expect(titles(sortLedger(inMonth, 'amount-low', order))).toEqual(['expense-books', 'expense-train', 'expense-groceries', 'income-salary']);
    expect(titles(sortLedger(inMonth, 'category', order))).toEqual(['expense-groceries', 'expense-train', 'expense-books', 'income-salary']);
    expect(titles(sortLedger(inMonth, 'payer', order))).toEqual(['expense-books', 'expense-groceries', 'income-salary', 'expense-train']);
    const tie = [{ ...expenses[0], id: 'a' }, { ...expenses[0], id: 'b' }];
    expect(titles(sortLedger(tie, 'amount-high', order))).toEqual(['b', 'a']);
  });

  it('puts a payer who is not listed last, and does not change its input', () => {
    const items = [{ ...expenses[0], id: 'gone', payerMembershipId: 'member-left' }, expenses[0]];
    expect(titles(sortLedger(items, 'payer', order))).toEqual([expenses[0].id, 'gone']);
    expect(items[0].id).toBe('gone');
  });

  it('groups by day with totals that keep income apart from spending', () => {
    const day = '2026-09-26';
    const items = sortLedger([{ ...expenses[0], id: 'one', incurredOn: day, kind: 'income', amountJpy: 700 }, { ...expenses[0], id: 'two', incurredOn: day, amountJpy: 300 }, { ...expenses[0], id: 'three', incurredOn: '2026-09-25', amountJpy: 100 }], 'date-new', order);
    expect(ledgerGroups(items, 'date-new').map(({ date, expenseJpy, incomeJpy, items: rows }) => ({ date, expenseJpy, incomeJpy, count: rows.length }))).toEqual([{ date: day, expenseJpy: 300, incomeJpy: 700, count: 2 }, { date: '2026-09-25', expenseJpy: 100, incomeJpy: 0, count: 1 }]);
  });

  it('does not split any other order into days', () => {
    expect(ledgerGroups(sortLedger(expenses, 'amount-high', order), 'amount-high')).toHaveLength(1);
    expect(ledgerGroups(sortLedger(expenses, 'amount-high', order), 'amount-high')[0].date).toBeNull();
    expect(ledgerGroups([], 'date-new')).toEqual([]);
  });
});
