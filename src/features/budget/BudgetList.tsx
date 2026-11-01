import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { EmptyState, formatDate, formatDateOnly, formatYen } from '../../design-system/components';
import { budgetPeriods, budgetRange, budgetSorts, filterLedger, ledgerGroups, monthRange, sortLedger, type BudgetCategory, type BudgetLocation, type BudgetPeriod, type BudgetSort, type DateRange, type LedgerGroup } from '../../domain/budgetView';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { expenseCategories, incomeCategories } from '../../domain/ledger';
import type { Expense } from '../../domain/types';
import { ExpenseRow } from './ExpenseRow';

const periodLabel = (period: BudgetPeriod, isCurrentMonth: boolean) => ({ month: '月全体', week: isCurrentMonth ? '今週' : '月の最初の週', custom: '日付で指定' }[period]);
const rangeText = ({ start, end }: DateRange) => (start === end ? formatDateOnly(start) : `${formatDateOnly(start)}〜${formatDateOnly(end)}`);

interface FilterProps {
  location: BudgetLocation;
  isCurrentMonth: boolean;
  status: string;
  onChange: (changes: Partial<BudgetLocation>) => void;
}

function ListFilters({ location, isCurrentMonth, status, onChange }: FilterProps) {
  const changePeriod = (period: BudgetPeriod) => {
    const month = monthRange(location.month);
    onChange(period === 'custom' ? { period, from: month.start, to: month.end } : { period, from: null, to: null });
  };
  return <section className="card budget-filters" aria-label="一覧の絞り込み">
    <div className="grid three">
      <div className="field"><label htmlFor="budget-category">費目</label>
        <select data-control-id="budget.list.category" className="select" id="budget-category" value={location.category ?? ''} onChange={(event) => onChange({ category: (event.target.value || null) as BudgetCategory | null })}>
          <option value="">すべての費目</option>
          <optgroup label={ja.expenseKind.expense}>{expenseCategories.map((category) => <option key={category} value={category}>{ja.expenseCategory[category]}</option>)}</optgroup>
          <optgroup label={ja.expenseKind.income}>{incomeCategories.map((category) => <option key={category} value={category}>{ja.expenseCategory[category]}</option>)}</optgroup>
        </select>
      </div>
      <div className="field"><label htmlFor="budget-period">期間</label>
        <select data-control-id="budget.list.period" className="select" id="budget-period" value={location.period} onChange={(event) => changePeriod(event.target.value as BudgetPeriod)}>
          {budgetPeriods.map((period) => <option key={period} value={period}>{periodLabel(period, isCurrentMonth)}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="budget-sort">並べ替え</label>
        <select data-control-id="budget.list.sort" className="select" id="budget-sort" value={location.sort} onChange={(event) => onChange({ sort: event.target.value as BudgetSort })}>
          {budgetSorts.map((sort) => <option key={sort} value={sort}>{ja.budgetSort[sort]}</option>)}
        </select>
      </div>
    </div>
    {location.period === 'custom' && <div className="grid two mt-1">
      <label className="field"><span>開始日</span><input data-control-id="budget.list.from" className="input" type="date" value={location.from ?? ''} onChange={(event) => onChange({ from: event.target.value || null })}/></label>
      <label className="field"><span>終了日</span><input data-control-id="budget.list.to" className="input" type="date" value={location.to ?? ''} onChange={(event) => onChange({ to: event.target.value || null })}/></label>
    </div>}
    <p className="meta mt-1 mb-0" role="status">{status}</p>
  </section>;
}

function DayTotal({ group }: { group: LedgerGroup }) {
  return <span className="amount meta">
    {group.expenseJpy > 0 && `支出 ${formatYen(group.expenseJpy)}`}
    {group.expenseJpy > 0 && group.incomeJpy > 0 && ' · '}
    {group.incomeJpy > 0 && `収入 ${formatYen(group.incomeJpy)}`}
  </span>;
}

/** 記録の一覧。日付の順では日ごとに区切って合計を出し、ほかの順では区切らない。 */
export function BudgetList({ expenses, location, currentMonth, search, onChange }: { expenses: Expense[]; location: BudgetLocation; currentMonth: string; search: string; onChange: (changes: Partial<BudgetLocation>) => void }) {
  const { snapshot } = useApp();
  const range = budgetRange(location, dateKeyFromRfc3339(snapshot.context.asOf));
  const memberOrder = snapshot.memberships.map((member) => member.id);
  const shown = sortLedger(filterLedger(expenses, range, location.category), location.sort, memberOrder);
  const groups = ledgerGroups(shown, location.sort);
  const filtered = location.category !== null || location.period !== 'month';
  return <>
    <ListFilters location={location} isCurrentMonth={location.month === currentMonth} status={`${rangeText(range)} · ${shown.length}件`} onChange={onChange}/>
    {shown.length === 0
      ? <div className="mt-1"><EmptyState title="該当する記録はありません" action={filtered ? <button data-control-id="budget.list.clear" className="button" type="button" onClick={() => onChange({ category: null, period: 'month', from: null, to: null })}>絞り込みを外す</button> : undefined}>{filtered ? '別の条件を選ぶか、絞り込みを外してください。' : 'この月の記録はまだありません。'}</EmptyState></div>
      : <section className="card mt-1" aria-label="記録の一覧">{groups.map((group) => <div className="ledger-group" key={group.date ?? 'all'}>
        {group.date && <div className="ledger-day"><h2>{formatDate(group.date)}</h2><DayTotal group={group}/></div>}
        <ul className="list">{group.items.map((expense) => <ExpenseRow expense={expense} search={search} showDate={!group.date} key={expense.id}/>)}</ul>
      </div>)}</section>}
  </>;
}
