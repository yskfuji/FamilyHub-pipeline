import { Suspense, lazy, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useReadingStatus } from './useReadingStatus';

/** 読み取りの画面は、開いたときに読む。 */
const EventDialog = lazy(async () => ({ default: (await import('./EventReadDialog')).EventDialog }));

/** 使える人にだけ出す。候補を選ぶと予定の入力を開くだけで、保存は利用者が行う。 */
export function EventReader() {
  const { can } = useApp();
  const status = useReadingStatus();
  const [open, setOpen] = useState(false);
  if (!status?.available || !can('assistant.use') || !can('event.create')) return null;
  return <>
    <button data-control-id="assistant.event.open" className="button" type="button" onClick={() => setOpen(true)}>URL・チラシから読み取る</button>
    {open && <Suspense fallback={null}><EventDialog sample={Boolean(status.sample)} onClose={() => setOpen(false)}/></Suspense>}
  </>;
}
