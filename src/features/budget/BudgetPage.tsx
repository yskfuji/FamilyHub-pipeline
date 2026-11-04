import { Suspense, lazy } from 'react';
import { useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { detailId, navigate, useSearch } from '../../app/router';
import { DetailNotFound, EmptyState, PageHeader, formatYen } from '../../design-system/components';
import { useContentWide } from '../../design-system/DetailSurface';
import { CheckIcon, YenIcon } from '../../design-system/icons';
import { ja, settleAllCopy } from '../../content/ja';
import { budgetSearch, latestBudgetMonth, monthChange, readBudgetLocation, type BudgetLocation } from '../../domain/budgetView';
import { monthKeyFromRfc3339 } from '../../domain/calendarDate';
import { ReceiptReader } from '../assistant/ReceiptReader';
import { PlaceAttributionLink } from '../place/PlaceAttribution';
import { MemberScopeSelect, ScopeNote } from '../shared/MemberScopeSelect';
import { BudgetList } from './BudgetList';
import { BudgetMembers } from './BudgetMembers';
import { BudgetMonthNav, BudgetTabs } from './BudgetNav';
import { BudgetOverview } from './BudgetOverview';
import { BudgetSettlements } from './BudgetSettlements';
import { useBudgetActions } from './useBudgetActions';

/** 記録の詳細と編集は、開いたときに読む。 */
const ExpenseDetail = lazy(async () => ({ default: (await import('./ExpenseDetail')).ExpenseDetail }));

export function BudgetPage({ path }: { path: string }) {
  const { snapshot, can, requestQuickCreate } = useApp();
  const search = useSearch();
  const { expenses, memberId } = useMemberScope();
  const wide = useContentWide();
  const currentMonth = monthKeyFromRfc3339(snapshot.context.asOf);
  const latestMonth = latestBudgetMonth(expenses, currentMonth);
  const location = readBudgetLocation(search, currentMonth, latestMonth);
  const close = () => navigate(`/budget${search}`, false, true);
  const { actions, undo, restore } = useBudgetActions(close);
  const activeId = detailId(path, '/budget');
  // 絞り込みの外の記録でも、URL で開いたものは表示する。
  const active = snapshot.expenses.find((expense) => expense.id === activeId);
  const href = (changes: Partial<BudgetLocation>) => `/budget${budgetSearch(search, changes, currentMonth)}`;
  const go = (changes: Partial<BudgetLocation>) => navigate(href(changes), false, true);
  const filter = (changes: Partial<BudgetLocation>) => navigate(href(changes), true, true);
  const canCreate = can('expense.create');
  const hasProvenance = expenses.some((expense) => expense.place?.provenance);
  return <div className="page">
    <PageHeader eyebrow="家計と精算" title="家計と割り勘" description="金額は1円単位で保存し、負担と精算を別の記録として残します。" action={<div className="page-head-actions"><MemberScopeSelect/>{canCreate && <div className="budget-actions">
      <ReceiptReader/>
      <button data-control-id="budget.income.create" className="button" type="button" onClick={() => requestQuickCreate('expense', undefined, 'income')}>収入を追加</button>
      <button data-control-id="budget.expense.create" className="button primary" type="button" onClick={() => requestQuickCreate('expense')}><YenIcon width="18"/>支出を追加</button>
    </div>}</div>}/>
    {undo?.kind === 'settlement' && <div className="callout info" role="status"><CheckIcon/><div><strong>{formatYen(undo.amountJpy)}の精算を記録しました</strong><p className="small muted mb-0">取り消しても、元の記録と取り消しの記録は履歴に残ります。</p></div><button data-control-id="budget.settlement.undo" className="button" type="button" disabled={actions.busy !== null} onClick={() => void actions.reverse(undo.entry)}>精算を取り消す</button></div>}
    {undo?.kind === 'batch' && <div className="callout info" role="status"><CheckIcon/><div><strong>{settleAllCopy.done(undo.batch.items.length)}</strong><p className="small muted mb-0">取り消しても、元の記録と取り消しの記録は履歴に残ります。</p></div><button data-control-id="budget.settle-all.undo" className="button" type="button" disabled={actions.busy !== null} onClick={() => void actions.reverseBatch(undo.batch.id)}>{settleAllCopy.reverse}</button></div>}
    {undo?.kind === 'deleted' && <div className="callout info" role="status"><CheckIcon/><div><strong>「{undo.expense.title}」を削除しました</strong><p className="small muted mb-0">7日以内なら元に戻せます。</p></div><button data-control-id="budget.expense.restore" className="button" type="button" disabled={actions.busy !== null} onClick={() => void restore(undo.expense)}>{ja.actions.restore}</button></div>}
    {activeId && !active && <DetailNotFound what="支出" feature="budget" backHref={`/budget${search}`}/>}
    <div className="detail-layout" data-pane={wide && active ? 'open' : undefined}><div className="detail-main">
    <BudgetTabs view={location.view} onView={(view) => go({ view })}/>
    {location.view !== 'settlements' && <BudgetMonthNav month={location.month} currentMonth={currentMonth} latestMonth={latestMonth} onMonth={(month) => go(monthChange(month))}/>}
    {expenses.length === 0
      ? <div className="mt-1"><EmptyState title={memberId ? '該当する記録はありません' : 'まだ記録がありません'}>{memberId ? <ScopeNote/> : '「支出を追加」や「収入を追加」から記録すると、ここに集計と精算の状態を表示します。'}</EmptyState></div>
      : <>
        {location.view === 'overview' && <BudgetOverview expenses={expenses} location={location} search={search} href={href}/>}
        {location.view === 'list' && <BudgetList expenses={expenses} location={location} currentMonth={currentMonth} search={search} onChange={filter}/>}
        {location.view === 'members' && <BudgetMembers expenses={expenses} month={location.month}/>}
        {location.view === 'settlements' && <BudgetSettlements expenses={expenses} search={search} onReverse={(entry) => void actions.reverse(entry)} busyId={actions.busy} memberFilterActive={Boolean(memberId)} actions={actions}/>}
      </>}
    {hasProvenance && location.view !== 'members' && <div className="mt-1"><PlaceAttributionLink where="budget"/></div>}
    </div>
    {active && <Suspense fallback={null}><ExpenseDetail expense={active} onClose={close} actions={actions}/></Suspense>}
    </div>
  </div>;
}
