import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useApp, type QuickCreateKind, type QuickCreateSeed } from './AppContext';
import { PlusIcon } from '../design-system/icons';
import type { EventPrefill } from '../domain/eventForm';
import type { Capability, Expense } from '../domain/types';

const QuickCreateDialog = lazy(() => import('./QuickCreateDialog'));

const kindTable: ReadonlyArray<readonly [QuickCreateKind, string, Capability]> = [['todo', 'タスク', 'task.create'], ['event', '予定', 'event.create'], ['memo', 'メモ', 'memo.create'], ['expense', '家計', 'expense.create']];

/** path が変わったら閉じる。保存していない入力の確認で「破棄する」を選んで移動したときも、開いたまま残さない。 */
export function QuickCreate({ path, placement }: { path: string; placement: 'floating' | 'topbar' }) {
  const { can } = useApp();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const [kind, setKind] = useState<QuickCreateKind>('todo');
  const [prefill, setPrefill] = useState<EventPrefill | null>(null);
  const [expenseKind, setExpenseKind] = useState<Expense['kind']>('expense');
  const [seed, setSeed] = useState<QuickCreateSeed | null>(null);
  // 開くたびに入力の状態を作り直す（開いたまま別の要求が来たときも）。
  const [opening, setOpening] = useState(0);
  const kinds = useMemo(() => kindTable.filter(([, , capability]) => can(capability)), [can]);

  // 開くたびに、要求された種類（なければ使える最初の種類）へ戻す。使えない種類のまま開かない。
  const openWith = (requested?: QuickCreateKind, eventPrefill?: EventPrefill, requestedExpenseKind?: Expense['kind'], requestedSeed?: QuickCreateSeed) => {
    const next = requested && kinds.some(([value]) => value === requested) ? requested : kinds[0]?.[0];
    if (!next) return;
    setKind(next); setPrefill(eventPrefill ?? null); setExpenseKind(requestedExpenseKind ?? 'expense'); setSeed(requestedSeed ?? null); setOpening((count) => count + 1); setOpenOn(path);
  };
  useEffect(() => {
    const openRequested = (event: Event) => { const { kind: requested, prefill: eventPrefill, expenseKind: requestedExpenseKind, seed: requestedSeed } = (event as CustomEvent<{ kind?: QuickCreateKind; prefill?: EventPrefill; expenseKind?: Expense['kind']; seed?: QuickCreateSeed }>).detail; openWith(requested, eventPrefill, requestedExpenseKind, requestedSeed); };
    window.addEventListener('family-hub:quick-create', openRequested);
    return () => window.removeEventListener('family-hub:quick-create', openRequested);
  });

  return <>
    <button type="button" className="button primary quick-create" data-placement={placement} data-control-id="quick-create.open" onClick={() => openWith()}><PlusIcon width="20"/><span>すぐに追加</span></button>
    {open && <Suspense fallback={null}><QuickCreateDialog key={opening} kinds={kinds} kind={kind} onKind={(value) => { setKind(value); setSeed(null); }} prefill={prefill} expenseKind={expenseKind} seed={seed} onClose={() => setOpenOn(null)}/></Suspense>}
  </>;
}
