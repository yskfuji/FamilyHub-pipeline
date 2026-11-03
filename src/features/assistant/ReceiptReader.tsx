import { Suspense, lazy, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useReadingStatus } from './useReadingStatus';

/** 読み取りの画面は、開いたときに読む。 */
const ReceiptDialog = lazy(async () => ({ default: (await import('./ReceiptReadDialog')).ReceiptDialog }));

/** 使える人にだけ出す。読み取った内容は支出の入力に入れるだけで、保存は利用者が行う。 */
export function ReceiptReader() {
  const { can } = useApp();
  const status = useReadingStatus();
  const [open, setOpen] = useState(false);
  if (!status?.available || !can('assistant.use') || !can('expense.create')) return null;
  return <>
    <button data-control-id="assistant.receipt.open" className="button" type="button" onClick={() => setOpen(true)}>領収書を読み取る</button>
    {open && <Suspense fallback={null}><ReceiptDialog sample={Boolean(status.sample)} onClose={() => setOpen(false)}/></Suspense>}
  </>;
}
