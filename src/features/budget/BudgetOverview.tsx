import { memberName, useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { EmptyState, formatSignedYen, formatYen } from '../../design-system/components';
import { EmptyBudget } from '../../design-system/illustrations/EmptyBudget';
import { BarChart, GroupedBarChart, type ChartTone } from '../../design-system/charts/BarCharts';
import { ChartFrame } from '../../design-system/charts/ChartFrame';
import { YenIcon } from '../../design-system/icons';
import { balanceOf, incomeBreakdown, monthComparison, monthOverview } from '../../domain/budgetSummary';
import { budgetTrend, trendIsDrawable, type TrendMonth } from '../../domain/budgetTrend';
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

/** 費目の内訳。多い順の横棒で、行ごとにその費目の一覧へのリンクにする。 */
function CategoryChart({ name, title, eyebrow, items, href, tone }: { name: string; title: string; eyebrow: string; items: ReadonlyArray<{ category: BudgetCategory; totalJpy: number; percent: number }>; href: (category: BudgetCategory) => string; tone: ChartTone }) {
  const id = `category-${eyebrow}`;
  const share = (item: typeof items[number]) => `（${item.percent}%）`;
  return <section className="card" aria-labelledby={id}>
    <p className="eyebrow">{eyebrow}</p>
    <h2 id={id}>{title}</h2>
    <ChartFrame name={name} table={{ caption: title, columns: ['費目', '金額', '割合'], rows: items.map((item) => ({ key: item.category, header: ja.expenseCategory[item.category], cells: [formatYen(item.totalJpy), `${item.percent}%`] })) }}>
      <BarChart tone={tone} room="share"
        items={items.map((item) => ({ key: item.category, name: ja.expenseCategory[item.category], value: item.totalJpy, label: <>{formatYen(item.totalJpy)}<tspan className="chart-label-soft">{share(item)}</tspan></> }))}
        wrap={(bar, content) => {
          const item = items.find((entry) => entry.category === bar.key)!;
          return <a data-control-id={`budget.category.open.${item.category}`} className="category-link" href={href(item.category)} data-link aria-label={`${ja.expenseCategory[item.category]}の記録を見る ${formatYen(item.totalJpy)}${share(item)}`}>{content}</a>;
        }}/>
    </ChartFrame>
  </section>;
}

/**
 * 表示中の月までの6か月の、月ごとの支出と収入。記録のない月は 0 円。記録のある月が2か月に満たなければ文で伝える。
 * 支出と収入は桁が大きく違うことが多く、1つの尺度にすると支出の棒が読めなくなるので、別の面に分けて並べる（どちらも 0 から）。
 */
function TrendCard({ expenses, month, currentMonth }: { expenses: Expense[]; month: string; currentMonth: string }) {
  const trend = budgetTrend(expenses, month);
  const first = trend.months[0].month;
  const mark = (key: string) => (key === currentMonth ? '今月' : key === month ? '表示中' : undefined);
  const peak = trend.months.reduce((top, item) => (item.spendingJpy > top.spendingJpy ? item : top), trend.months[0]);
  const panels: ReadonlyArray<{ key: 'spending' | 'income'; name: string; tone: ChartTone; pick: (item: TrendMonth) => number }> = [
    { key: 'spending', name: '支出', tone: 1, pick: (item) => item.spendingJpy },
    ...(trend.showIncome ? [{ key: 'income' as const, name: '収入', tone: 4 as const, pick: (item: TrendMonth) => item.incomeJpy }] : []),
  ];
  const summary = `${monthLabel(first)}から${monthLabel(month)}までの、月ごとの${panels.map((panel) => panel.name).join('と')}。${shortMonth(month)}の支出は${formatYen(trend.months.at(-1)!.spendingJpy)}、6か月でいちばん支出が多いのは${shortMonth(peak.month)}の${formatYen(peak.spendingJpy)}です。`;
  return <section className="card mt-1" aria-labelledby="trend-title">
    <p className="eyebrow">推移</p>
    <h2 id="trend-title">6か月の推移</h2>
    {!trendIsDrawable(trend)
      ? <p className="chart-note" data-chart-empty="trend">記録のある月が2か月以上になると、{shortMonth(first)}から{shortMonth(month)}までの推移を表示します。</p>
      : <>
        <p className="muted small">月ごとの{panels.map((panel) => panel.name).join('と')}の合計です。記録のない月は0円です。{panels.length > 1 && '支出と収入は、それぞれの最も多い月を同じ長さにして描いています。'}</p>
        <ChartFrame name="trend" summary={summary} table={{
          caption: `${monthLabel(first)}〜${monthLabel(month)}の推移`,
          columns: ['月', ...panels.map((panel) => panel.name)],
          rows: trend.months.map((item) => ({ key: item.month, header: `${monthLabel(item.month)}${mark(item.month) ? `（${mark(item.month)}）` : ''}`, cells: panels.map((panel) => formatYen(panel.pick(item))) })),
        }}>
          <div className="chart-panels">{panels.map((panel) => <div className="chart-panel" key={panel.key} data-panel={panel.key}>
            <p className="chart-panel-title">{panel.name}</p>
            <GroupedBarChart room="yen" series={[{ key: panel.key, name: panel.name, tone: panel.tone }]} groups={trend.months.map((item) => ({
              key: item.month, name: shortMonth(item.month), mark: mark(item.month),
              values: { [panel.key]: panel.pick(item) },
              labels: { [panel.key]: formatYen(panel.pick(item)) },
            }))}/>
          </div>)}</div>
        </ChartFrame>
      </>}
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
  currentMonth: string;
  search: string;
  href: (changes: Partial<BudgetLocation>) => string;
}

/** 月の収支、先月との比較、最近の記録、費目の内訳、未精算のまとめ。 */
export function BudgetOverview({ expenses, location, currentMonth, search, href }: Props) {
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
    <EmptyState title={`${monthLabel(month)}の記録はありません`} illustration={<EmptyBudget/>}>別の月を選ぶか、支出や収入を追加してください。</EmptyState>
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
        {categories.length > 0 && <CategoryChart name="spending-categories" tone={1} eyebrow="費目別" title={`${shortMonth(month)}の支出の内訳`} items={categories} href={categoryHref}/>}
        {income.length > 0 && <CategoryChart name="income-categories" tone={4} eyebrow="収入" title={`${shortMonth(month)}の収入の内訳`} items={income} href={categoryHref}/>}
      </div>
      {unsettled}
    </div>
    <TrendCard expenses={expenses} month={month} currentMonth={currentMonth}/>
    <section className="card mt-1" aria-labelledby="recent-title">
      <div className="section-head"><div><p className="eyebrow">記録</p><h2 id="recent-title">最近の記録</h2></div><a data-control-id="budget.recent.open-list" className="button" href={href({ view: 'list' })} data-link>一覧を見る</a></div>
      <ul className="list">{recent.map((expense) => <ExpenseRow expense={expense} search={search} key={expense.id}/>)}</ul>
    </section>
  </>;
}
