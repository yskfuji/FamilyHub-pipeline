import { useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { AlertIcon } from '../../design-system/icons';
import { activeAdults, defaultCategory, expenseDraftProblem, expenseTitleLabel, payerChoices, peopleOutsideExpense, type ExpenseDraft } from '../../domain/expenseForm';
import { expenseCategories, incomeCategories } from '../../domain/ledger';
import type { Expense } from '../../domain/types';
import { PlaceField } from '../place/PlaceField';
import { VisibilityFields } from '../shared/VisibilityFields';
import { ExpenseSplitFields } from './ExpenseSplitFields';

const kinds: ReadonlyArray<Expense['kind']> = ['expense', 'income'];

interface Props {
  /** 操作の ID の末尾に使う。新規は new。 */
  formId: string;
  initial: ExpenseDraft;
  /** 編集のときの元の記録。種類は作るときにだけ選べる。 */
  original?: Expense;
  /** 精算の記録があり、金額と負担を変えられないとき。 */
  splitLocked: boolean;
  submitLabel: string;
  busy: boolean;
  error: string;
  onSubmit: (draft: ExpenseDraft) => void;
  onCancel: () => void;
}

/** 支出と収入の入力。追加と編集で同じものを使う。収入には負担がない。 */
export function ExpenseForm({ formId, initial, original, splitLocked, submitLabel, busy, error, onSubmit, onCancel }: Props) {
  const { snapshot, can } = useApp();
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState('');
  const patch = (changes: Partial<ExpenseDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const income = draft.kind === 'income';
  const adultIds = activeAdults(snapshot.memberships).map((member) => member.id);
  const payers = payerChoices(snapshot.memberships, initial.payerId);
  const categories = income ? incomeCategories : expenseCategories;
  const selectable = snapshot.memberships.filter((member) => member.status === 'active' || draft.selectedIds.includes(member.id));
  const outside = peopleOutsideExpense(draft, adultIds, snapshot.memberships, original?.creatorMembershipId ?? snapshot.viewer.membershipId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = expenseDraftProblem(draft, splitLocked);
    setProblem(found ?? '');
    if (!found) onSubmit(draft);
  };
  const shown = problem || error;
  return <form className="stack budget-form" aria-busy={busy} noValidate onSubmit={submit}>
    {original
      ? <p className="small muted mb-0">種類：{ja.expenseKind[original.kind]}（記録したあとは変えられません）</p>
      : <fieldset className="fieldset"><legend>種類</legend><div className="choice-grid">{kinds.map((kind) => <label key={kind}><input data-control-id={`budget.form.kind.${formId}.${kind}`} type="radio" name={`kind-${formId}`} value={kind} checked={draft.kind === kind} onChange={() => patch({ kind, category: defaultCategory(kind) })}/>{ja.expenseKind[kind]}</label>)}</div></fieldset>}
    <label className="field"><span>{expenseTitleLabel(draft.kind)}</span><input data-control-id={`budget.form.title.${formId}`} className="input" name="title" autoFocus required maxLength={120} aria-describedby={`expense-title-help-${formId}`} value={draft.title} onChange={(event) => patch({ title: event.target.value })}/><span className="field-help" id={`expense-title-help-${formId}`}>{income ? '例：9月の給与' : '例：学校教材'}</span></label>
    <div className="grid two">
      <label className="field"><span>日付</span><input data-control-id={`budget.form.date.${formId}`} className="input" type="date" name="date" required value={draft.date} onChange={(event) => patch({ date: event.target.value })}/></label>
      <label className="field"><span>費目</span><select data-control-id={`budget.form.category.${formId}`} className="select" name="category" value={draft.category} onChange={(event) => patch({ category: event.target.value as Expense['category'] })}>{categories.map((category) => <option key={category} value={category}>{ja.expenseCategory[category]}</option>)}</select></label>
    </div>
    <fieldset className="fieldset stack" disabled={splitLocked} aria-describedby={splitLocked ? `split-locked-${formId}` : undefined}>
      <legend>{income ? '金額' : '金額と負担'}</legend>
      <div className="grid two">
        <label className="field"><span>金額（円）</span><input data-control-id={`budget.form.amount.${formId}`} className="input" name="amount" inputMode="numeric" autoComplete="off" required value={draft.amount} onChange={(event) => patch({ amount: event.target.value })}/></label>
        <label className="field"><span>{income ? '受け取った人' : '支払った人'}</span><select data-control-id={`budget.form.payer.${formId}`} className="select" name="payer" value={draft.payerId} onChange={(event) => patch({ payerId: event.target.value })}>{payers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
      </div>
      {!income && <ExpenseSplitFields formId={formId} draft={draft} adultIds={adultIds} onChange={patch}/>}
      {splitLocked && <p className="field-help mb-0" id={`split-locked-${formId}`}>精算の記録があるため、金額・支払った人・負担する人は変更できません。変えるには、先に精算を取り消してください。</p>}
    </fieldset>
    <label className="field"><span>メモ（任意）</span><textarea data-control-id={`budget.form.note.${formId}`} className="textarea" name="note" maxLength={500} value={draft.note} onChange={(event) => patch({ note: event.target.value })}/></label>
    <VisibilityFields kind="expense" formId={formId} audience={draft.audience} selectedIds={draft.selectedIds} initialAudience={initial.audience} people={selectable} onChange={patch}/>
    {outside.length > 0 && <div className="callout" role="status"><AlertIcon/><p className="small mb-0">{outside.map((member) => member.displayName).join('、')}さんには、この公開範囲だと記録が表示されません。</p></div>}
    {!income && can('place.read') && <PlaceField value={draft.place} onChange={(place) => patch({ place })} disabled={busy}/>}
    {shown && <p className="field-error" role="alert">{shown}</p>}
    <div className="dialog-actions">
      <button data-control-id={`budget.form.cancel.${formId}`} className="button" type="button" disabled={busy} onClick={onCancel}>{ja.actions.cancel}</button>
      <button data-control-id={`budget.form.submit.${formId}`} className="button primary" type="submit" disabled={busy}>{busy ? ja.actions.saving : submitLabel}</button>
    </div>
  </form>;
}
