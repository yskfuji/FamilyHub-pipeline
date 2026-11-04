import { useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { ja, settleAllCopy } from '../../content/ja';
import { serverMessages } from '../../content/serverMessages';
import { Dialog, formatYen } from '../../design-system/components';
import { ArrowIcon } from '../../design-system/icons';
import type { SettleAllInput, SettlementBatch } from '../../domain/types';

interface Props {
  /** 開いたときに画面に示していた内容（settleAllRequest）。開いている間は変えない。 */
  request: SettleAllInput;
  onClose: () => void;
  onDone: (batch: SettlementBatch) => void;
}

/**
 * まとめて精算の確かめ（A4-3, 4, 8）。開いたときに示した負担と受け渡しだけを送る。
 * 冪等キーはこのダイアログに1つ（二度押しや応答切れのやり直しでも1回の記録になる）。オフラインの待ち行列には入れない。
 * 本人の再確認が要るときは、送ったあとでパスワードを尋ねる（src/app/reauth.tsx）。
 * 内容が古くなっていて断られたら、理由を示し、最新の内容を読み込んでから開き直してもらう。
 */
export function SettleAllDialog({ request, onClose, onDone }: Props) {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [shown] = useState(request);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  // stale: 示した内容が古くなった（読み込み直せば記録できる）。refused: まとめては記録できない（1件ずつにする）。
  const [error, setError] = useState<{ message: string; kind: 'stale' | 'refused' | 'other' } | null>(null);
  const expenseCount = new Set(shown.shares.map((share) => share.expenseId)).size;

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    const result = await gateway.expenses.settleAll(shown, idempotencyKey);
    if (!result.ok) {
      setBusy(false);
      const kind = result.error.code !== 'CONFLICT' ? 'other' : result.error.message === serverMessages.settleAllChanged ? 'stale' : 'refused';
      setError({ message: result.error.message, kind });
      return;
    }
    await refresh();
    setBusy(false);
    onDone(result.value);
    onClose();
  };
  const reload = async () => {
    setBusy(true);
    await refresh();
    setBusy(false);
    onClose();
    announce(settleAllCopy.reloaded);
  };

  return <Dialog title={settleAllCopy.title} description={settleAllCopy.description(shown.shares.length)} onClose={() => { if (!busy) onClose(); }} actions={<>
    <button data-control-id="budget.settle-all.cancel" className="button" type="button" disabled={busy} onClick={onClose}>{error?.kind === 'refused' ? ja.actions.close : ja.actions.cancel}</button>
    {error?.kind === 'refused' ? null : error?.kind === 'stale'
      ? <button data-control-id="budget.settle-all.reload" className="button primary" type="button" disabled={busy} onClick={() => void reload()}>{settleAllCopy.reload}</button>
      : <button data-control-id="budget.settle-all.confirm" className="button primary" type="button" disabled={busy} aria-busy={busy} onClick={() => void submit()}>{busy ? settleAllCopy.busy : settleAllCopy.confirm}</button>}
  </>}>
    <section aria-labelledby="settle-all-transfers">
      <h3 id="settle-all-transfers">{settleAllCopy.transfersHeading}</h3>
      {shown.transfers.length === 0
        ? <p className="muted">{settleAllCopy.noTransfer}</p>
        : <ul className="settle-transfers">{shown.transfers.map((transfer) => <li key={`${transfer.from}-${transfer.to}`}>
          <span className="settle-transfer-people" aria-hidden="true">{memberName(snapshot, transfer.from)}さん<ArrowIcon width="16" aria-hidden="true"/>{memberName(snapshot, transfer.to)}さん</span>
          <span className="sr-only">{settleAllCopy.transfer(memberName(snapshot, transfer.from), memberName(snapshot, transfer.to))}</span>
          <strong className="amount">{formatYen(transfer.amountJpy)}</strong>
        </li>)}</ul>}
      <p className="small muted">{settleAllCopy.records(expenseCount)}</p>
    </section>
    <p className="small">{settleAllCopy.note}</p>
    {error && <div className="notice error" role="alert">{error.kind === 'stale' && <strong className="notice-title">{settleAllCopy.stale}</strong>}<p className="mb-0">{error.message}</p></div>}
  </Dialog>;
}
