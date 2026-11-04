import { shiftMonthKey } from './calendarDate';
import { monthIncome, monthSummary } from './ledger';
import type { Expense } from './types';

/** 推移に並べる月の数。 */
export const TREND_MONTHS = 6;

export interface TrendMonth {
  /** YYYY-MM。家族の時間帯での日付（incurredOn）の月。 */
  month: string;
  spendingJpy: number;
  incomeJpy: number;
  /** その月に支出か収入の記録が1件でもあるか。記録のない月は 0 円として並べる（空けない）。 */
  hasRecords: boolean;
}

export interface BudgetTrend {
  /** 古い月から新しい月の順。最後が endMonth。 */
  months: TrendMonth[];
  /** 期間の中に収入の記録があるときだけ、収入も並べる。 */
  showIncome: boolean;
  /** 記録のある月の数。2か月に満たないときは推移として描かない。 */
  monthsWithRecords: number;
}

/**
 * endMonth までの count か月の、月ごとの支出と収入の合計。
 * 渡すのは閲覧者に見えている記録（公開範囲で投影したもの）を、表示する人で絞ったもの。月の合計（monthSummary・monthIncome）と
 * 同じ関数で数えるので、概要の数字と食い違わない。
 */
export function budgetTrend(expenses: Expense[], endMonth: string, count = TREND_MONTHS): BudgetTrend {
  const months = Array.from({ length: count }, (_, index) => shiftMonthKey(endMonth, index - count + 1)).map((month): TrendMonth => {
    const spending = monthSummary(expenses, month);
    const income = monthIncome(expenses, month);
    return { month, spendingJpy: spending.totalJpy, incomeJpy: income.totalJpy, hasRecords: spending.count + income.count > 0 };
  });
  return { months, showIncome: months.some((month) => month.incomeJpy > 0), monthsWithRecords: months.filter((month) => month.hasRecords).length };
}

/** 推移として描けるか。記録のある月が2か月以上あること。 */
export const trendIsDrawable = (trend: BudgetTrend) => trend.monthsWithRecords >= 2;
