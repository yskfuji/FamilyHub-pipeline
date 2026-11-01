import { useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { canDeleteResource } from '../../authz/policy';
import { Dialog, formatDateOnly, formatYen } from '../../design-system/components';
import { DetailSurface } from '../../design-system/DetailSurface';
import { MapPinIcon } from '../../design-system/icons';
import { ja } from '../../content/ja';
import { activeAdults, expenseDraftToUpdateInput, expenseToDraft, type ExpenseDraft } from '../../domain/expenseForm';
import { hasActiveSettlement, remainingOf, settlementHistory } from '../../domain/ledger';
import { keyOfPlace } from '../../domain/places';
import type { Expense } from '../../domain/types';
import { expenseUpdateSchema, type ExpenseUpdateInput } from '../../domain/schemas';
import { PlaceAttributionLink, PlaceSummary } from '../place/PlaceField';
import { audienceText } from '../shared/visibilityText';
import { ExpenseForm } from './ExpenseForm';
import { payerLabel } from './ExpenseRow';
import { SettlementForm } from './SettlementForm';
import { SettlementHistory } from './SettlementHistory';
import type { ExpenseActions } from './useBudgetActions';

function ShareSection({ expense, actions }: { expense: Expense; actions: ExpenseActions }) {
  const { snapshot, can } = useApp();
  const remaining = remainingOf(expense);
  const shared = expense.shares.some((share) => share.membershipId !== expense.payerMembershipId);
  const history = settlementHistory([expense]);
  return <>
    <section aria-labelledby={`shares-${expense.id}`}>
      <h3 id={`shares-${expense.id}`}>負担と精算</h3>
      <div className="ledger-scroll" role="group" aria-labelledby={`shares-${expense.id}`} tabIndex={0}><table className="ledger-table">
        <thead><tr><th scope="col">人</th><th scope="col">負担</th><th scope="col">精算済み</th><th scope="col">残り</th></tr></thead>
        <tbody>{expense.shares.map((share) => {
          const isPayer = share.membershipId === expense.payerMembershipId;
          return <tr key={share.membershipId}><th scope="row">{memberName(snapshot, share.membershipId)}{isPayer ? '（支払った人）' : ''}</th><td>{formatYen(share.amountJpy)}</td><td>{formatYen(share.settledJpy)}</td><td>{isPayer ? '—' : formatYen(Math.max(0, share.amountJpy - share.settledJpy))}</td></tr>;
        })}</tbody>
      </table></div>
      {can('expense.settle') && remaining.length > 0 && <div className="stack mt-1">{remaining.map((share) => <SettlementForm key={`${share.membershipId}-${share.amountJpy}`} expense={expense} membershipId={share.membershipId} remainingJpy={share.amountJpy} actions={actions}/>)}</div>}
      {remaining.length === 0 && <p className="small muted mb-0 mt-1">{shared ? 'すべて精算済みです。' : '支払った人だけの負担なので、精算はありません。'}</p>}
    </section>
    <section aria-labelledby={`history-${expense.id}`}>
      <h3 id={`history-${expense.id}`}>精算の履歴</h3>
      <SettlementHistory entries={history} showExpense={false} onReverse={(entry) => void actions.reverse(entry)} busyId={actions.busy}/>
    </section>
  </>;
}

/** 支出の詳細。概要 → 場所 → 負担 → 精算の履歴 の順に、判断に必要な情報から並べる。 */
export function ExpenseDetail({ expense, onClose, actions }: { expense: Expense; onClose: () => void; actions: ExpenseActions }) {
  const { snapshot, can } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const locked = hasActiveSettlement(expense);
  const income = expense.kind === 'income';
  const kindLabel = ja.expenseKind[expense.kind];
  // 削除できるのは作った人と支払った人だけ。それ以外の人にはボタンを出さない。
  const canDelete = canDeleteResource(snapshot.viewer, 'expense.delete', [expense.creatorMembershipId, expense.payerMembershipId]).allowed;
  return <>
    <DetailSurface eyebrow={`${kindLabel}の内容`} title={expense.title} onClose={onClose}>
      <div className="stack">
        <dl className="detail-list">
          <div><dt>金額</dt><dd className="amount">{formatYen(expense.amountJpy)}</dd></div>
          <div><dt>日付</dt><dd>{formatDateOnly(expense.incurredOn)}</dd></div>
          <div><dt>種類</dt><dd>{kindLabel}</dd></div>
          <div><dt>費目</dt><dd>{ja.expenseCategory[expense.category]}</dd></div>
          <div><dt>{payerLabel(expense)}</dt><dd>{memberName(snapshot, expense.payerMembershipId)}さん</dd></div>
          <div><dt>公開範囲</dt><dd>{audienceText('expense', expense.visibility, (id) => memberName(snapshot, id))}</dd></div>
          {expense.note && <div><dt>メモ</dt><dd className="wrap">{expense.note}</dd></div>}
        </dl>
        {expense.place && <section aria-labelledby={`place-${expense.id}`}>
          <h3 id={`place-${expense.id}`}>{ja.place.legend}</h3>
          <PlaceSummary place={expense.place}/>
          <a data-control-id={`budget.expense.place.${expense.id}`} className="button mt-1" href={`/places/${keyOfPlace(expense.place)}`} data-link><MapPinIcon width="17"/>この場所の記録を見る</a>
          {expense.place.provenance && <PlaceAttributionLink where="expense"/>}
        </section>}
        {!income && <ShareSection expense={expense} actions={actions}/>}
        {(can('expense.update') || canDelete) && <div className="grid two">
          {can('expense.update') && <button data-control-id={`budget.expense.edit.${expense.id}`} className="button" type="button" onClick={() => setEditing(true)}>内容を編集</button>}
          {canDelete && <button data-control-id={`budget.expense.delete.${expense.id}`} className="button danger" type="button" disabled={locked} aria-describedby={locked ? `delete-help-${expense.id}` : undefined} onClick={() => setDeleting(true)}>{kindLabel}を削除</button>}
        </div>}
        {canDelete && locked && <p className="small muted mb-0" id={`delete-help-${expense.id}`}>精算の記録があるため削除できません。削除するには、先に精算を取り消してください。</p>}
      </div>
    </DetailSurface>
    {editing && <ExpenseEditDialog expense={expense} locked={locked} onClose={() => setEditing(false)} onSave={(input) => actions.update(expense, input)}/>}
    {deleting && <Dialog title={`${kindLabel}を削除しますか`} description={`「${expense.title}」（${formatYen(expense.amountJpy)}）を削除します。`} onClose={() => setDeleting(false)} actions={<><button data-control-id={`budget.expense.delete-cancel.${expense.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button><button data-control-id={`budget.expense.delete-confirm.${expense.id}`} className="button danger" type="button" disabled={actions.busy !== null} onClick={async () => { await actions.remove(expense); setDeleting(false); }}>{ja.actions.delete}</button></>}><p className="muted">{income ? '月の集計からも外れます。' : '未精算の集計からも外れます。'}削除後7日間は元に戻せます。</p></Dialog>}
  </>;
}

function ExpenseEditDialog({ expense, locked, onClose, onSave }: { expense: Expense; locked: boolean; onClose: () => void; onSave: (input: ExpenseUpdateInput) => Promise<string | null> }) {
  const { snapshot } = useApp();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const adultIds = activeAdults(snapshot.memberships).map((member) => member.id);
  const submit = async (draft: ExpenseDraft) => {
    if (saving) return;
    const parsed = expenseUpdateSchema.safeParse(expenseDraftToUpdateInput(draft, expense, adultIds, locked));
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '入力内容を確認してください。'); return; }
    setSaving(true); setError('');
    const message = await onSave(parsed.data);
    setSaving(false);
    if (message) setError(message); else onClose();
  };
  return <Dialog title={`${ja.expenseKind[expense.kind]}を編集`} description="保存に失敗した場合も、入力中の内容は残ります。" onClose={() => { if (!saving) onClose(); }}>
    <ExpenseForm formId={expense.id} initial={expenseToDraft(expense, adultIds)} original={expense} splitLocked={locked} submitLabel={ja.actions.saveChanges} busy={saving} error={error} onSubmit={(draft) => void submit(draft)} onCancel={onClose}/>
  </Dialog>;
}
