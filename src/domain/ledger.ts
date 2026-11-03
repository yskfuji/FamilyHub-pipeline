import type { Expense, Id, IncomeCategory, SettleAllInput, SettlementRecord, SettlementTransfer, SpendingCategory } from './types';

/**
 * 家計の集計。画面・ヒント・今日の画面が同じ計算を使い、表示が食い違わないようにする。
 * 入力は閲覧者に見えている支出（削除済みを除く）とする。
 */

export type ExpenseCategory = SpendingCategory;
export const expenseCategories: readonly SpendingCategory[] = ['food', 'dining', 'transport', 'utilities', 'home', 'education', 'health', 'entertainment', 'shopping', 'savings', 'other'];
export const incomeCategories: readonly IncomeCategory[] = ['income_salary', 'income_bonus', 'income_side', 'income_investment', 'income_gift', 'income_other'];

const live = (expenses: Expense[]) => expenses.filter((expense) => !expense.deletedAt);
const spending = (expenses: Expense[]) => live(expenses).filter((expense) => expense.kind !== 'income');

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
  const inMonth = spending(expenses).filter((expense) => expense.incurredOn.startsWith(`${monthKey}-`));
  return { totalJpy: inMonth.reduce((sum, expense) => sum + expense.amountJpy, 0), count: inMonth.length };
}

/** 月の収入の合計。支出の集計には含めない。 */
export function monthIncome(expenses: Expense[], monthKey: string) {
  const inMonth = live(expenses).filter((expense) => expense.kind === 'income' && expense.incurredOn.startsWith(`${monthKey}-`));
  return { totalJpy: inMonth.reduce((sum, expense) => sum + expense.amountJpy, 0), count: inMonth.length };
}

/** 端数を最大剰余法で配り、表示する割合の合計を必ず100にする。 */
export function percentages(values: number[]): number[] {
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
  const inMonth = spending(expenses).filter((expense) => expense.incurredOn.startsWith(`${monthKey}-`));
  const totals = expenseCategories
    .map((category) => ({ category, totalJpy: inMonth.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.amountJpy, 0) }))
    .filter((item) => item.totalJpy > 0)
    .sort((a, b) => b.totalJpy - a.totalJpy || expenseCategories.indexOf(a.category) - expenseCategories.indexOf(b.category));
  const shares = percentages(totals.map((item) => item.totalJpy));
  return totals.map((item, index) => ({ ...item, percent: shares[index] }));
}

/** 支払った人以外の負担のうち、まだ残りがあるもの。まとめた精算（A4）はこの単位で記録する。 */
export interface OpenShare { expenseId: Id; membershipId: Id; payerMembershipId: Id; remainingJpy: number }

export function openShares(expenses: Expense[]): OpenShare[] {
  return live(expenses).flatMap((expense) => remainingOf(expense).map((share) => ({ expenseId: expense.id, membershipId: share.membershipId, payerMembershipId: expense.payerMembershipId, remainingJpy: share.amountJpy })));
}

/** 人ごとの正味。正は受け取る額、負は渡す額。合計は必ず0になる。 */
export function netBalances(shares: ReadonlyArray<Pick<OpenShare, 'membershipId' | 'payerMembershipId' | 'remainingJpy'>>): Map<Id, number> {
  const net = new Map<Id, number>();
  for (const share of shares) {
    net.set(share.membershipId, (net.get(share.membershipId) ?? 0) - share.remainingJpy);
    net.set(share.payerMembershipId, (net.get(share.payerMembershipId) ?? 0) + share.remainingJpy);
  }
  return net;
}

/**
 * 正味を、最大の貸し手と最大の借り手を組んで受け渡しにする（貪欲法）。1回ごとに少なくとも1人の正味が0になるので、
 * 受け渡しの数は、正味が0でない人の数から1を引いた数以下になる。最小の数にする問題は強 NP 困難（evidence.md §15）。
 */
export function transfersFor(balances: ReadonlyMap<Id, number>): SettlementTransfer[] {
  const largestFirst = (a: { amountJpy: number; id: Id }, b: { amountJpy: number; id: Id }) => b.amountJpy - a.amountJpy || a.id.localeCompare(b.id);
  const entries = [...balances].map(([id, amountJpy]) => ({ id, amountJpy }));
  const debtors = entries.filter((item) => item.amountJpy < 0).map((item) => ({ id: item.id, amountJpy: -item.amountJpy })).sort(largestFirst);
  const creditors = entries.filter((item) => item.amountJpy > 0).sort(largestFirst);
  const transfers: SettlementTransfer[] = [];
  let debtor = 0;
  let creditor = 0;
  while (debtor < debtors.length && creditor < creditors.length) {
    const amountJpy = Math.min(debtors[debtor].amountJpy, creditors[creditor].amountJpy);
    transfers.push({ from: debtors[debtor].id, to: creditors[creditor].id, amountJpy });
    debtors[debtor].amountJpy -= amountJpy;
    creditors[creditor].amountJpy -= amountJpy;
    if (debtors[debtor].amountJpy === 0) debtor += 1;
    if (creditors[creditor].amountJpy === 0) creditor += 1;
  }
  return transfers;
}

/** 受け渡しが、正味をちょうど0にするか。人ごとに、受け取る額から渡す額を引いたものが正味と一致すること。 */
export function transfersSettle(balances: ReadonlyMap<Id, number>, transfers: readonly SettlementTransfer[]): boolean {
  const left = new Map(balances);
  for (const transfer of transfers) {
    left.set(transfer.from, (left.get(transfer.from) ?? 0) + transfer.amountJpy);
    left.set(transfer.to, (left.get(transfer.to) ?? 0) - transfer.amountJpy);
  }
  return [...left.values()].every((value) => value === 0);
}

/**
 * 残りのある記録をすべて相殺したうえで、誰が誰にいくら渡せば済むか。金額の大きい順。
 * 3人以上では、記録にない組み合わせの受け渡しになることがある。まとめて記録するときは settleAllRequest を使う。
 */
export function simplifiedTransfers(expenses: Expense[]) {
  return transfersFor(netBalances(openShares(expenses)));
}

/**
 * 画面に示した内容から、まとめた精算（settleAll）の要求を作る。expenses は閲覧者に見えている支出。
 * 人で絞って表示しているとき（「すべて」以外）は、示した一覧が家計の全体ではないので null（ボタンを出さない）。
 * 精算するものがなければ null。
 */
export function settleAllRequest(expenses: Expense[], options: { memberFilterActive: boolean }): SettleAllInput | null {
  if (options.memberFilterActive) return null;
  const shares = openShares(expenses);
  if (!shares.length) return null;
  return { shares: shares.map(({ expenseId, membershipId, remainingJpy }) => ({ expenseId, membershipId, remainingJpy })), transfers: transfersFor(netBalances(shares)) };
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
