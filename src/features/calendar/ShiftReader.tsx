import { Suspense, lazy, useState } from 'react';
import { useApp } from '../../app/AppContext';

/** 読み取りの画面（表の解析と確認）は、開いたときに読む。 */
const ShiftDialog = lazy(async () => ({ default: (await import('./ShiftDialog')).ShiftDialog }));

/** 予定を作れる人に出す。貼り付けた文字は端末の外へ出さず、保存を押すまで予定を作らない。 */
export function ShiftReader() {
  const { can } = useApp();
  const [open, setOpen] = useState(false);
  if (!can('event.create')) return null;
  return <>
    <button data-control-id="calendar.shift.open" className="button" type="button" onClick={() => setOpen(true)}>シフトを読み取る</button>
    {open && <Suspense fallback={null}><ShiftDialog onClose={() => setOpen(false)}/></Suspense>}
  </>;
}
