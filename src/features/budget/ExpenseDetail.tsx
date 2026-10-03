import { useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { Dialog, Drawer, formatDateOnly, formatYen } from '../../design-system/components';
import { MapPinIcon } from '../../design-system/icons';
import { ja } from '../../content/ja';
import { expenseCategories, hasActiveSettlement, remainingOf, settlementHistory, type SettlementHistoryEntry } from '../../domain/ledger';
import { keyOfPlace } from '../../domain/places';
import type { Expense, PlaceRef } from '../../domain/types';
import type { ExpenseUpdateInput } from '../../domain/schemas';
import { PlaceAttributionLink, PlaceField, PlaceSummary } from '../place/PlaceField';
import { SettlementHistory } from './SettlementHistory';

export interface ExpenseActions {
  settle(expense: Expense, fromMembershipId: string, amountJpy: number): Promise<void>;
  reverse(entry: SettlementHistoryEntry): Promise<void>;
  update(expense: Expense, input: ExpenseUpdateInput): Promise<string | null>;
  remove(expense: Expense): Promise<void>;
  busy: string | null;
}

/** 支出の詳細。概要 → 場所 → 負担 → 精算の履歴 の順に、判断に必要な情報から並べる。 */
export function ExpenseDetail({ expense, onClose, actions }: { expense: Expense; onClose: () => void; actions: ExpenseActions }) {
  const { snapshot, can } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remaining = remainingOf(expense);
  const locked = hasActiveSettlement(expense);
  const history = settlementHistory([expense]);
  return <>
    <Drawer eyebrow="支出の内容" title={expense.title} onClose={onClose}>
      <div className="stack">
        <dl className="detail-list">
          <div><dt>金額</dt><dd className="amount">{formatYen(expense.amountJpy)}</dd></div>
          <div><dt>日付</dt><dd>{formatDateOnly(expense.incurredOn)}</dd></div>
          <div><dt>費目</dt><dd>{ja.expenseCategory[expense.category]}</dd></div>
          <div><dt>支払った人</dt><dd>{memberName(snapshot, expense.payerMembershipId)}さん</dd></div>
          {expense.note && <div><dt>メモ</dt><dd className="wrap">{expense.note}</dd></div>}
        </dl>
        {expense.place && <section aria-labelledby={`place-${expense.id}`}>
          <h3 id={`place-${expense.id}`}>{ja.place.legend}</h3>
          <PlaceSummary place={expense.place}/>
          <a data-control-id={`budget.expense.place.${expense.id}`} className="button mt-1" href={`/places/${keyOfPlace(expense.place)}`} data-link><MapPinIcon width="17"/>この場所の記録を見る</a>
          {expense.place.provenance && <PlaceAttributionLink where="expense"/>}
        </section>}
        <section aria-labelledby={`shares-${expense.id}`}>
          <h3 id={`shares-${expense.id}`}>負担と精算</h3>
          <table className="ledger-table">
            <thead><tr><th scope="col">人</th><th scope="col">負担</th><th scope="col">精算済み</th><th scope="col">残り</th></tr></thead>
            <tbody>{expense.shares.map((share) => {
              const isPayer = share.membershipId === expense.payerMembershipId;
              return <tr key={share.membershipId}><th scope="row">{memberName(snapshot, share.membershipId)}{isPayer ? '（支払った人）' : ''}</th><td>{formatYen(share.amountJpy)}</td><td>{formatYen(share.settledJpy)}</td><td>{isPayer ? '—' : formatYen(Math.max(0, share.amountJpy - share.settledJpy))}</td></tr>;
            })}</tbody>
          </table>
          {can('expense.settle') && remaining.length > 0 && <div className="stack mt-1">{remaining.map((share) => <button key={share.membershipId} data-control-id={`budget.settlement.record.${expense.id}.${share.membershipId}`} className="button primary" type="button" disabled={actions.busy !== null} onClick={() => void actions.settle(expense, share.membershipId, share.amountJpy)}>{memberName(snapshot, share.membershipId)}さんの残り{formatYen(share.amountJpy)}を精算</button>)}</div>}
          {remaining.length === 0 && <p className="small muted mb-0 mt-1">すべて精算済みです。</p>}
        </section>
        <section aria-labelledby={`history-${expense.id}`}>
          <h3 id={`history-${expense.id}`}>精算の履歴</h3>
          <SettlementHistory entries={history} showExpense={false} onReverse={(entry) => void actions.reverse(entry)} busyId={actions.busy}/>
        </section>
        {can('expense.create') && <div className="grid two">
          <button data-control-id={`budget.expense.edit.${expense.id}`} className="button" type="button" onClick={() => setEditing(true)}>内容を編集</button>
          <button data-control-id={`budget.expense.delete.${expense.id}`} className="button danger" type="button" disabled={locked} aria-describedby={locked ? `delete-help-${expense.id}` : undefined} onClick={() => setDeleting(true)}>支出を削除</button>
        </div>}
        {can('expense.create') && locked && <p className="small muted mb-0" id={`delete-help-${expense.id}`}>精算の記録があるため削除できません。削除するには、先に精算を取り消してください。</p>}
      </div>
    </Drawer>
    {editing && <ExpenseEditDialog expense={expense} locked={locked} onClose={() => setEditing(false)} onSave={async (input) => { const message = await actions.update(expense, input); if (!message) setEditing(false); return message; }}/>}
    {deleting && <Dialog title="支出を削除しますか" description={`「${expense.title}」（${formatYen(expense.amountJpy)}）を削除します。`} onClose={() => setDeleting(false)} actions={<><button data-control-id={`budget.expense.delete-cancel.${expense.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button><button data-control-id={`budget.expense.delete-confirm.${expense.id}`} className="button danger" type="button" disabled={actions.busy !== null} onClick={async () => { await actions.remove(expense); setDeleting(false); }}>{ja.actions.delete}</button></>}><p className="muted">未精算の集計からも外れます。削除後7日間は元に戻せます。</p></Dialog>}
  </>;
}

function ExpenseEditDialog({ expense, locked, onClose, onSave }: { expense: Expense; locked: boolean; onClose: () => void; onSave: (input: ExpenseUpdateInput) => Promise<string | null> }) {
  const { snapshot, can } = useApp();
  const [place, setPlace] = useState<PlaceRef | null>(expense.place ?? null);
  const [placeChanged, setPlaceChanged] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const payers = snapshot.memberships.filter((member) => member.role === 'owner' || member.role === 'adult');
  const submit = async (form: HTMLFormElement) => {
    if (saving) return;
    const values = new FormData(form);
    const input: ExpenseUpdateInput = {
      title: String(values.get('title') ?? ''),
      incurredOn: String(values.get('incurredOn') ?? ''),
      category: String(values.get('category')) as Expense['category'],
      note: String(values.get('note') ?? '').trim() || null,
      ...(locked ? {} : { amountJpy: Number(values.get('amount')), payerMembershipId: String(values.get('payer')), shareMembershipIds: values.getAll('shares').map(String) }),
      ...(placeChanged ? { place } : {}),
    };
    if (!locked && !input.shareMembershipIds?.length) { setError('負担する人を1人以上選んでください。'); return; }
    setSaving(true); setError('');
    const message = await onSave(input);
    setSaving(false);
    if (message) setError(message);
  };
  return <Dialog title="支出を編集" description="保存に失敗した場合も、入力中の内容は残ります。" onClose={() => { if (!saving) onClose(); }}>
    <form className="stack" aria-busy={saving} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
      <label className="field"><span>支出名</span><input data-control-id={`budget.edit.title.${expense.id}`} className="input" name="title" required maxLength={120} defaultValue={expense.title}/></label>
      <div className="grid two">
        <label className="field"><span>日付</span><input data-control-id={`budget.edit.date.${expense.id}`} className="input" type="date" name="incurredOn" required defaultValue={expense.incurredOn}/></label>
        <label className="field"><span>費目</span><select data-control-id={`budget.edit.category.${expense.id}`} className="select" name="category" defaultValue={expense.category}>{expenseCategories.map((category) => <option key={category} value={category}>{ja.expenseCategory[category]}</option>)}</select></label>
      </div>
      <fieldset className="fieldset" disabled={locked} aria-describedby={locked ? `split-locked-${expense.id}` : undefined}>
        <legend>金額と負担</legend>
        <div className="grid two">
          <label className="field"><span>金額（円）</span><input data-control-id={`budget.edit.amount.${expense.id}`} className="input" type="number" name="amount" min="1" step="1" required defaultValue={expense.amountJpy}/></label>
          <label className="field"><span>支払った人</span><select data-control-id={`budget.edit.payer.${expense.id}`} className="select" name="payer" defaultValue={expense.payerMembershipId}>{payers.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
        </div>
        <div className="choice-grid">{payers.map((member) => <label key={member.id}><input data-control-id={`budget.edit.share.${expense.id}.${member.id}`} type="checkbox" name="shares" value={member.id} defaultChecked={expense.shares.some((share) => share.membershipId === member.id)}/>{member.displayName}</label>)}</div>
        {locked && <p className="field-help mb-0" id={`split-locked-${expense.id}`}>精算の記録があるため、金額・支払った人・負担する人は変更できません。変えるには、先に精算を取り消してください。</p>}
      </fieldset>
      <label className="field"><span>メモ（任意）</span><textarea data-control-id={`budget.edit.note.${expense.id}`} className="textarea" name="note" maxLength={500} defaultValue={expense.note ?? ''}/></label>
      {can('place.read') && <PlaceField value={place} onChange={(next) => { setPlace(next); setPlaceChanged(true); }} disabled={saving}/>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button data-control-id={`budget.edit.cancel.${expense.id}`} className="button" type="button" disabled={saving} onClick={onClose}>{ja.actions.cancel}</button><button data-control-id={`budget.edit.submit.${expense.id}`} className="button primary" type="submit" disabled={saving}>{saving ? ja.actions.saving : ja.actions.saveChanges}</button></div>
    </form>
  </Dialog>;
}
