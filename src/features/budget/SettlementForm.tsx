import { useState, type FormEvent } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { formatYen } from '../../design-system/components';
import { parseYen } from '../../domain/expenseForm';
import { settlementAmountProblem, settlementPresets } from '../../domain/settlementForm';
import type { Expense, Id } from '../../domain/types';
import type { ExpenseActions } from './useBudgetActions';
import { AmountInput } from '../../design-system/AmountInput';

interface Props {
  expense: Expense;
  membershipId: Id;
  remainingJpy: number;
  actions: Pick<ExpenseActions, 'settle' | 'busy'>;
}

const presetLabels = { full: '残り全額', half: '半分' } as const;

/** 1人ぶんの精算。残りの額までの好きな額を記録できる。残りが変わると、親が key で作り直して入力を残りの額に戻す。 */
export function SettlementForm({ expense, membershipId, remainingJpy, actions }: Props) {
  const { snapshot } = useApp();
  const [amount, setAmount] = useState(String(remainingJpy));
  const [problem, setProblem] = useState('');
  const name = memberName(snapshot, membershipId);
  const key = `${expense.id}-${membershipId}`;
  const parsed = parseYen(amount);
  const submitLabel = parsed === remainingJpy ? `${name}さんの残り${formatYen(remainingJpy)}を精算` : parsed ? `${name}さんの${formatYen(parsed)}を精算` : `${name}さんの精算を記録`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = settlementAmountProblem(amount, remainingJpy, formatYen);
    setProblem(found ?? '');
    if (found || parsed === null) return;
    const failure = await actions.settle(expense, membershipId, parsed);
    if (failure) setProblem(failure);
  };
  return <form className="settlement-form" aria-label={`${name}さんの精算`} noValidate onSubmit={(event) => void submit(event)}>
    <div className="field">
      <label htmlFor={`settle-${key}`}>{name}さんの精算額（残り{formatYen(remainingJpy)}）</label>
      <AmountInput data-control-id={`budget.settlement.amount.${expense.id}.${membershipId}`} className="input" id={`settle-${key}`} value={amount} aria-invalid={problem ? true : undefined} aria-describedby={problem ? `settle-error-${key}` : undefined} onValueChange={(value) => { setAmount(value); setProblem(''); }}/>
    </div>
    <div className="settlement-presets" role="group" aria-label={`${name}さんのすぐに選べる額`}>
      {settlementPresets(remainingJpy).map((preset) => <button key={preset.kind} data-control-id={`budget.settlement.preset.${preset.kind}.${expense.id}.${membershipId}`} className="button" type="button" onClick={() => { setAmount(String(preset.amountJpy)); setProblem(''); }}>{presetLabels[preset.kind]}（{formatYen(preset.amountJpy)}）</button>)}
    </div>
    {problem && <p className="field-error" id={`settle-error-${key}`} role="alert">{problem}</p>}
    <button data-control-id={`budget.settlement.record.${expense.id}.${membershipId}`} className="button primary" type="submit" disabled={actions.busy !== null}>{submitLabel}</button>
  </form>;
}
