import { memberName, useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { EmptyState, formatSignedYen, formatYen } from '../../design-system/components';
import { YenIcon } from '../../design-system/icons';
import { balanceOf, incomeBreakdown, monthComparison, monthOverview } from '../../domain/budgetSummary';
import { sortLedger, type BudgetCategory, type BudgetLocation } from '../../domain/budgetView';
import { categoryBreakdown, simplifiedTransfers, unsettledSummary } from '../../domain/ledger';
import type { Expense } from '../../domain/types';
import { monthLabel } from './BudgetNav';
import { ExpenseRow } from './ExpenseRow';

const RECENT_COUNT = 8;

const shortMonth = (month: string) => `${Number(month.slice(5, 7))}月`;

function comparisonText({ previousMonth, differenceJpy }: ReturnType<typeof monthComparison>) {
  if (differenceJpy === null) return `先月（${shortMonth(previousMonth)}）の支出の記録はありません。`;
  if (differenceJpy === 0) return `支出は先月（${shortMonth(previousMonth)}）と同じです。`;
  return `支出は先月（${shortMonth(previousMonth)}）より${formatYen(Math.abs(differenceJpy))}${differenceJpy > 0 ? '多い' : '少ない'}です。`;
}

/** 収入のうち支出に使った割合を、文字と1本の棒で示す。棒は文字と同じ内容なので読み上げない。 */
function BalanceCard({ spendingJpy, incomeJpy, comparison }: { spendingJpy: number; incomeJpy: number; comparison: string }) {
  const { percent, leftJpy, overJpy } = balanceOf(spendingJpy, incomeJpy);
  const over = overJpy > 0;
  const summary = percent === null ? 'この月の収入の記録はありません。'
    : over ? `支出が収入を${formatYen(overJpy)}上回っています。`
      : `収入の${percent}%を支出にあて、${formatYen(leftJpy)}残っています。`;
  return <section className="card mt-1" aria-labelledby="balance-title">
    <p className="eyebrow">収支</p>
    <h2 id="balance-title">収入と支出のバランス</h2>
    <p className="mb-0">{summary}</p>
    {percent !== null && <div className="bar balance-bar" data-over={over || undefined} aria-hidden="true"><span style={{ width: `${Math.min(100, spendingJpy > 0 ? Math.max(1, percent) : 0)}%` }}/></div>}
    <p className="muted small mb-0 mt-1">{comparison}</p>
  </section>;
}

function CategoryBars({ title, eyebrow, items, href }: { title: string; eyebrow: string; items: ReadonlyArray<{ category: BudgetCategory; totalJpy: number; percent: number }>; href: (category: BudgetCategory) => string }) {
  const id = `category-${eyebrow}`;
  return <section className="card" aria-labelledby={id}>
    <p className="eyebrow">{eyebrow}</p>
    <h2 id={id}>{title}</h2>
    <ul className="category-list">{items.map((item) => <li key={item.category}>
      <a data-control-id={`budget.category.open.${item.category}`} className="category-link" href={href(item.category)} data-link aria-label={`${ja.expenseCategory[item.category]}の記録を見る ${formatYen(item.totalJpy)}（${item.percent}%）`}>
        <span className="split"><strong>{ja.expenseCategory[item.category]}</strong><span className="amount">{formatYen(item.totalJpy)}<span className="muted">（{item.percent}%）</span></span></span>
        <span className="bar" aria-hidden="true"><span style={{ width: `${item.percent}%` }}/></span>
      </a>
    </li>)}</ul>
  </section>;
}

function UnsettledCard({ expenses, settlementsHref }: { expenses: Expense[]; settlementsHref: string }) {
  const { snapshot } = useApp();
  const unsettled = unsettledSummary(expenses);
  const transfers = simplifiedTransfers(expenses);
  return <section className="card" aria-labelledby="debt-title">
    <p className="eyebrow">未精算の内訳</p>
    <h2 id="debt-title">誰にいくら支払うか</h2>
    {unsettled.count === 0 ? <p className="muted mb-0">すべて精算済みです。</p> : <div className="stack">
      <p className="mb-0">残りのある記録が{unsettled.count}件、合計{formatYen(unsettled.totalJpy)}です。</p>
      {transfers.map((transfer) => <div className="callout" key={`${transfer.from}-${transfer.to}`}><YenIcon/><div><strong>{memberName(snapshot, transfer.from)}さんから{memberName(snapshot, transfer.to)}さんへ</strong><p className="metric mb-0">{formatYen(transfer.amountJpy)}</p></div></div>)}
      <a data-control-id="budget.unsettled.open" className="button" href={settlementsHref} data-link>精算の画面を開く</a>
    </div>}
  </section>;
}

interface Props {
  expenses: Expense[];
  location: BudgetLocation;
  search: string;
  href: (changes: Partial<BudgetLocation>) => string;
}

/** 月の収支、先月との比較、最近の記録、費目の内訳、未精算のまとめ。 */
export function BudgetOverview({ expenses, location, search, href }: Props) {
  const { snapshot } = useApp();
  const { month } = location;
  const overview = monthOverview(expenses, month);
  const categories = categoryBreakdown(expenses, month);
  const income = incomeBreakdown(expenses, month);
  const memberOrder = snapshot.memberships.map((member) => member.id);
  const recent = sortLedger(expenses.filter((expense) => expense.incurredOn.startsWith(`${month}-`)), 'date-new', memberOrder).slice(0, RECENT_COUNT);
  const categoryHref = (category: BudgetCategory) => href({ view: 'list', category });
  const unsettled = <UnsettledCard expenses={expenses} settlementsHref={href({ view: 'settlements' })}/>;
  if (overview.count === 0) return <div className="stack">
    <EmptyState title={`${monthLabel(month)}の記録はありません`}>別の月を選ぶか、支出や収入を追加してください。</EmptyState>
    {unsettled}
  </div>;
  return <>
    <div className="grid three budget-tiles">
      <section className="card accent"><span className="meta">{shortMonth(month)}の支出</span><p className="metric">{formatYen(overview.spending.totalJpy)}</p><p className="muted small mb-0">{monthLabel(month)}の支出{overview.spending.count}件の合計</p></section>
      <section className="card"><span className="meta">{shortMonth(month)}の収入</span><p className="metric">{formatYen(overview.income.totalJpy)}</p><p className="muted small mb-0">{overview.income.count > 0 ? `収入${overview.income.count}件の合計` : '収入の記録はありません'}</p></section>
      <section className="card"><span className="meta">差し引き</span><p className="metric">{formatSignedYen(overview.netJpy)}</p><p className="muted small mb-0">収入から支出を引いた額</p></section>
    </div>
    <BalanceCard spendingJpy={overview.spending.totalJpy} incomeJpy={overview.income.totalJpy} comparison={comparisonText(monthComparison(expenses, month))}/>
    <div className="grid two mt-1">
      <div className="stack budget-column">
        {categories.length > 0 && <CategoryBars eyebrow="費目別" title={`${shortMonth(month)}の支出の内訳`} items={categories} href={categoryHref}/>}
        {income.length > 0 && <CategoryBars eyebrow="収入" title={`${shortMonth(month)}の収入の内訳`} items={income} href={categoryHref}/>}
      </div>
      {unsettled}
    </div>
    <section className="card mt-1" aria-labelledby="recent-title">
      <div className="section-head"><div><p className="eyebrow">記録</p><h2 id="recent-title">最近の記録</h2></div><a data-control-id="budget.recent.open-list" className="button" href={href({ view: 'list' })} data-link>一覧を見る</a></div>
      <ul className="list">{recent.map((expense) => <ExpenseRow expense={expense} search={search} key={expense.id}/>)}</ul>
    </section>
  </>;
}
