import { addDateKeyDays, isDateKey, isMonthKey, shiftMonthKey, weekDates } from './calendarDate';
import { expenseCategories, incomeCategories } from './ledger';
import type { Expense, Id } from './types';

/** 家計の画面の状態。URL の ?view= ?month= ?period= ?from= ?to= ?category= ?sort= と対応する。 */
export const budgetViews = ['overview', 'list', 'members', 'settlements'] as const;
export type BudgetView = typeof budgetViews[number];
export const budgetPeriods = ['month', 'week', 'custom'] as const;
export type BudgetPeriod = typeof budgetPeriods[number];
export const budgetSorts = ['date-new', 'date-old', 'amount-high', 'amount-low', 'category', 'payer'] as const;
export type BudgetSort = typeof budgetSorts[number];
export type BudgetCategory = Expense['category'];

const categoryOrder: readonly BudgetCategory[] = [...expenseCategories, ...incomeCategories];

export interface BudgetLocation {
  view: BudgetView;
  month: string;
  period: BudgetPeriod;
  category: BudgetCategory | null;
  sort: BudgetSort;
  from: string | null;
  to: string | null;
}

export interface DateRange { start: string; end: string }

const pick = <T extends string>(choices: readonly T[], value: string | null, fallback: T): T => (choices.includes(value as T) ? value as T : fallback);

/** 移動できる最後の月。今月より先の日付の記録があれば、その月まで開ける。 */
export function latestBudgetMonth(expenses: readonly Expense[], currentMonth: string): string {
  return expenses.reduce((latest, expense) => {
    const month = expense.incurredOn.slice(0, 7);
    return month > latest ? month : latest;
  }, currentMonth);
}

export function readBudgetLocation(search: string, currentMonth: string, latestMonth: string): BudgetLocation {
  const params = new URLSearchParams(search);
  const month = params.get('month');
  const category = params.get('category') as BudgetCategory | null;
  const from = params.get('from');
  const to = params.get('to');
  return {
    view: pick(budgetViews, params.get('view'), 'overview'),
    month: isMonthKey(month) && month <= latestMonth ? month : currentMonth,
    period: pick(budgetPeriods, params.get('period'), 'month'),
    category: category && categoryOrder.includes(category) ? category : null,
    sort: pick(budgetSorts, params.get('sort'), 'date-new'),
    from: isDateKey(from) ? from : null,
    to: isDateKey(to) ? to : null,
  };
}

/** クエリを変える。既定の値は URL に載せず、家計に関係のない項目はそのまま残す。 */
export function budgetSearch(search: string, changes: Partial<BudgetLocation>, currentMonth: string): string {
  const params = new URLSearchParams(search);
  const write = (name: keyof BudgetLocation, fallback?: string) => {
    if (!(name in changes)) return;
    const value = changes[name];
    if (value === null || value === undefined || value === fallback) params.delete(name);
    else params.set(name, value);
  };
  write('view', 'overview');
  write('month', currentMonth);
  write('period', 'month');
  write('category');
  write('sort', 'date-new');
  write('from');
  write('to');
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** 月を移す。週と日付の指定は前の月のものなので外す。 */
export const monthChange = (month: string): Partial<BudgetLocation> => ({ month, period: 'month', from: null, to: null });

export function monthRange(month: string): DateRange {
  return { start: `${month}-01`, end: addDateKeyDays(`${shiftMonthKey(month, 1)}-01`, -1) };
}

/**
 * 一覧に出す期間。週はカレンダーと同じ日曜はじまりで、表示中の月の中に切り詰める。
 * 今月なら今日を含む週、ほかの月なら最初の週。日付の指定は月をまたいでよく、前後が逆なら入れ替える。
 */
export function budgetRange(location: Pick<BudgetLocation, 'month' | 'period' | 'from' | 'to'>, today: string): DateRange {
  const month = monthRange(location.month);
  if (location.period === 'week') {
    const days = weekDates(today.startsWith(`${location.month}-`) ? today : month.start);
    return { start: days[0] > month.start ? days[0] : month.start, end: days[6] < month.end ? days[6] : month.end };
  }
  if (location.period === 'custom' && location.from && location.to) {
    return location.from <= location.to ? { start: location.from, end: location.to } : { start: location.to, end: location.from };
  }
  return month;
}

export function filterLedger(expenses: readonly Expense[], range: DateRange, category: BudgetCategory | null): Expense[] {
  return expenses.filter((expense) => expense.incurredOn >= range.start && expense.incurredOn <= range.end && (!category || expense.category === category));
}

const newestFirst = (a: Expense, b: Expense) => b.incurredOn.localeCompare(a.incurredOn) || b.id.localeCompare(a.id);
const oldestFirst = (a: Expense, b: Expense) => a.incurredOn.localeCompare(b.incurredOn) || a.id.localeCompare(b.id);

/** 並べる。同じ値どうしは日付の新しい順。支払った人はメンバーの並びに合わせる。 */
export function sortLedger(expenses: readonly Expense[], sort: BudgetSort, memberOrder: readonly Id[]): Expense[] {
  const memberRank = (id: Id) => {
    const index = memberOrder.indexOf(id);
    return index < 0 ? memberOrder.length : index;
  };
  const compare: Record<BudgetSort, (a: Expense, b: Expense) => number> = {
    'date-new': newestFirst,
    'date-old': oldestFirst,
    'amount-high': (a, b) => b.amountJpy - a.amountJpy || newestFirst(a, b),
    'amount-low': (a, b) => a.amountJpy - b.amountJpy || newestFirst(a, b),
    category: (a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || newestFirst(a, b),
    payer: (a, b) => memberRank(a.payerMembershipId) - memberRank(b.payerMembershipId) || newestFirst(a, b),
  };
  return [...expenses].sort(compare[sort]);
}

export interface LedgerGroup {
  /** 日付の順でないときは null。区切らず1つにまとめる。 */
  date: string | null;
  items: Expense[];
  expenseJpy: number;
  incomeJpy: number;
}

/** 日付の順では日ごとに区切って合計を出す。ほかの順では区切らない。 */
export function ledgerGroups(sorted: readonly Expense[], sort: BudgetSort): LedgerGroup[] {
  const byDate = sort === 'date-new' || sort === 'date-old';
  const groups: LedgerGroup[] = [];
  for (const expense of sorted) {
    const date = byDate ? expense.incurredOn : null;
    let group = groups.at(-1);
    if (!group || group.date !== date) {
      group = { date, items: [], expenseJpy: 0, incomeJpy: 0 };
      groups.push(group);
    }
    group.items.push(expense);
    if (expense.kind === 'income') group.incomeJpy += expense.amountJpy;
    else group.expenseJpy += expense.amountJpy;
  }
  return groups;
}
