import type { Expense, Id, SettlementRecord } from './types';

/**
 * 家計の集計。画面・ヒント・今日の画面が同じ計算を使い、表示が食い違わないようにする。
 * 入力は閲覧者に見えている支出（削除済みを除く）とする。
 */

export type ExpenseCategory = Expense['category'];
export const expenseCategories: readonly ExpenseCategory[] = ['food', 'transport', 'education', 'home', 'other'];

const live = (expenses: Expense[]) => expenses.filter((expense) => !expense.deletedAt);

/** 支払った人以外の負担のうち、まだ精算されていない額。 */
export function remainingOf(expense: Expense): Array<{ membershipId: Id; amountJpy: number }> {
  return expense.shares
    .filter((share) => share.membershipId !== expense.payerMembershipId)
    .map((share) => ({ membershipId: share.membershipId, amountJpy: Math.max(0, share.amountJpy - share.settledJpy) }))
    .filter((share) => share.amountJpy > 0);
}

export const remainingTotal = (expense: Expense) => remainingOf(expense).reduce((sum, share) => sum + share.amountJpy, 0);

export function unsettledSummary(expenses: Expense[]) {
  const open = live(expenses).filter((expense) => remainingTotal(expense) > 0);
  return { totalJpy: open.reduce((sum, expense) => sum + remainingTotal(expense), 0), count: open.length };
}

/** 精算済みの正味。取り消しの記録（負の額）を差し引く。 */
export function settledNet(expenses: Expense[]): number {
  return live(expenses).flatMap((expense) => expense.settlements).reduce((sum, record) => sum + record.amountJpy, 0);
}

export function monthSummary(expenses: Expense[], monthKey: string) {
  const inMonth = live(expenses).filter((expense) => expense.incurredOn.startsWith(`${monthKey}-`));
  return { totalJpy: inMonth.reduce((sum, expense) => sum + expense.amountJpy, 0), count: inMonth.length };
}

/** 端数を最大剰余法で配り、表示する割合の合計を必ず100にする。 */
function percentages(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);
  const raw = values.map((value) => (value / total) * 100);
  const floored = raw.map(Math.floor);
  let rest = 100 - floored.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) { if (rest <= 0) break; floored[index] += 1; rest -= 1; }
  return floored;
}

/** 費目別の合計（多い順）。0円の費目は出さない。 */
export function categoryBreakdown(expenses: Expense[], monthKey: string) {
  const inMonth = live(expenses).filter((expense) => expense.incurredOn.startsWith(`${monthKey}-`));
  const totals = expenseCategories
    .map((category) => ({ category, totalJpy: inMonth.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amountJpy, 0) }))
    .filter((item) => item.totalJpy > 0)
    .sort((a, b) => b.totalJpy - a.totalJpy || expenseCategories.indexOf(a.category) - expenseCategories.indexOf(b.category));
  const shares = percentages(totals.map((item) => item.totalJpy));
  return totals.map((item, index) => ({ ...item, percent: shares[index] }));
}

/** 誰が誰にいくら払うか。同じ2人の間の貸し借りは相殺し、残った向きだけを返す。 */
export function whoOwesWhom(expenses: Expense[]) {
  const balance = new Map<string, { from: Id; to: Id; amountJpy: number; expenseIds: Id[] }>();
  for (const expense of live(expenses)) {
    for (const share of remainingOf(expense)) {
      const [a, b] = [share.membershipId, expense.payerMembershipId].sort();
      const key = `${a}|${b}`;
      const entry = balance.get(key) ?? { from: a, to: b, amountJpy: 0, expenseIds: [] };
      entry.amountJpy += share.membershipId === a ? share.amountJpy : -share.amountJpy;
      entry.expenseIds.push(expense.id);
      balance.set(key, entry);
    }
  }
  return [...balance.values()]
    .filter((entry) => entry.amountJpy !== 0)
    .map((entry) => (entry.amountJpy > 0 ? entry : { ...entry, from: entry.to, to: entry.from, amountJpy: -entry.amountJpy }))
    .sort((a, b) => b.amountJpy - a.amountJpy);
}

export interface SettlementHistoryEntry {
  expenseId: Id;
  expenseTitle: string;
  record: SettlementRecord;
  /** 取り消しの記録なら、取り消した元の精算。 */
  reverses?: SettlementRecord;
  /** 元の精算なら、それを取り消した記録。 */
  reversedBy?: SettlementRecord;
  canReverse: boolean;
}

/** 精算の履歴（新しい順）。記録は書き換えず、取り消しは反対の記録として並べる。 */
export function settlementHistory(expenses: Expense[]): SettlementHistoryEntry[] {
  return live(expenses).flatMap((expense) => expense.settlements.map((record): SettlementHistoryEntry => {
    const reverses = record.reversalOfSettlementId ? expense.settlements.find((item) => item.id === record.reversalOfSettlementId) : undefined;
    const reversedBy = expense.settlements.find((item) => item.reversalOfSettlementId === record.id);
    return { expenseId: expense.id, expenseTitle: expense.title, record, reverses, reversedBy, canReverse: record.amountJpy > 0 && !record.reversedAt };
  })).sort((a, b) => b.record.recordedAt.localeCompare(a.record.recordedAt) || b.record.id.localeCompare(a.record.id));
}

/** 金額・支払った人・負担を変えてよいか。精算が1件でも生きていれば、記録の整合のため変えられない。 */
export const hasActiveSettlement = (expense: Expense) => expense.settlements.some((record) => record.amountJpy > 0 && !record.reversedAt);

/** 円を負担者に配る。端数は先頭から1円ずつ。支払った人の負担は最初から精算済みとする。 */
export function splitShares(amountJpy: number, payerMembershipId: Id, shareMembershipIds: Id[]) {
  const base = Math.floor(amountJpy / shareMembershipIds.length);
  let remainder = amountJpy - base * shareMembershipIds.length;
  return shareMembershipIds.map((membershipId) => {
    const amount = base + (remainder-- > 0 ? 1 : 0);
    return { membershipId, amountJpy: amount, settledJpy: membershipId === payerMembershipId ? amount : 0 };
  });
}
