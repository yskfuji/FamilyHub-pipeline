import { ja } from '../../content/ja';
import { budgetViews, type BudgetView } from '../../domain/budgetView';
import { shiftMonthKey } from '../../domain/calendarDate';

export const monthLabel = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;

export function BudgetTabs({ view, onView }: { view: BudgetView; onView: (view: BudgetView) => void }) {
  return <div className="segmented budget-tabs" role="group" aria-label="家計の表示">
    {budgetViews.map((value) => <button data-control-id={`budget.view.${value}`} key={value} type="button" aria-pressed={view === value} onClick={() => onView(value)}>{ja.budgetView[value]}</button>)}
  </div>;
}

interface MonthProps {
  month: string;
  currentMonth: string;
  /** これより先の月へは進めない。 */
  latestMonth: string;
  onMonth: (month: string) => void;
}

export function BudgetMonthNav({ month, currentMonth, latestMonth, onMonth }: MonthProps) {
  return <div className="budget-month" role="group" aria-label="表示する月の移動">
    <button data-control-id="budget.month.previous" className="button" type="button" onClick={() => onMonth(shiftMonthKey(month, -1))}>前月</button>
    <strong className="budget-month-heading" aria-live="polite">{monthLabel(month)}</strong>
    <button data-control-id="budget.month.current" className="button" type="button" disabled={month === currentMonth} onClick={() => onMonth(currentMonth)}>今月</button>
    <button data-control-id="budget.month.next" className="button" type="button" disabled={month >= latestMonth} onClick={() => onMonth(shiftMonthKey(month, 1))}>次月</button>
  </div>;
}
