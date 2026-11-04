import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { formatYen } from '../../design-system/components';
import { customSplitGap, plannedShares, seedCustomAmounts, splitModes, type ExpenseDraft, type SplitMode } from '../../domain/expenseForm';
import type { Id } from '../../domain/types';
import { AmountInput } from '../../design-system/AmountInput';

interface Props {
  formId: string;
  draft: ExpenseDraft;
  adultIds: readonly Id[];
  onChange: (changes: Partial<ExpenseDraft>) => void;
}

const gapText = (gap: number | null) => {
  if (gap === null) return '先に金額を入力してください。';
  if (gap === 0) return '負担の合計は金額と同じです。';
  return gap > 0 ? `あと${formatYen(gap)}を割り当ててください。` : `金額より${formatYen(-gap)}多くなっています。`;
};

/** 負担の分け方。「金額を指定」の欄には、大人と、今その記録を負担している人を出す。 */
export function ExpenseSplitFields({ formId, draft, adultIds, onChange }: Props) {
  const { snapshot } = useApp();
  const nameOf = (id: Id) => snapshot.memberships.find((member) => member.id === id)?.displayName ?? '非公開';
  const rows = [...new Set([...adultIds, ...Object.keys(draft.customAmounts)])];
  const select = (splitMode: SplitMode) => onChange(splitMode === 'custom' ? { splitMode, customAmounts: seedCustomAmounts(draft, adultIds) } : { splitMode });
  return <fieldset className="fieldset">
    <legend>負担の分け方</legend>
    <div className="split-choice">{splitModes.map((mode) => <label key={mode}><input data-control-id={`budget.form.split.${formId}.${mode}`} type="radio" name={`split-${formId}`} value={mode} checked={draft.splitMode === mode} onChange={() => select(mode)}/>{ja.splitMode[mode]}</label>)}</div>
    {draft.splitMode === 'custom'
      ? <>
        <div className="grid two mt-1">{rows.map((id) => <label className="field" key={id}><span>{nameOf(id)}さんの負担（円）</span><AmountInput data-control-id={`budget.form.share.${formId}.${id}`} className="input" value={draft.customAmounts[id] ?? ''} onValueChange={(amount) => onChange({ customAmounts: { ...draft.customAmounts, [id]: amount } })}/></label>)}</div>
        <p className="field-help mb-0 mt-1" role="status">{gapText(customSplitGap(draft))}</p>
      </>
      : <p className="field-help mb-0 mt-1">{plannedShares(draft, adultIds).map((share) => `${nameOf(share.membershipId)}さん ${formatYen(share.amountJpy)}`).join('・')}</p>}
  </fieldset>;
}
