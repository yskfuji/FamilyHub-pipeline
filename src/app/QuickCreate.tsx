import { useEffect, useMemo, useState } from 'react';
import { todoInputSchema } from '../domain/schemas';
import { useApp } from './AppContext';
import { Dialog } from '../design-system/components';
import { PlusIcon } from '../design-system/icons';
import { ja } from '../content/ja';
import { PlaceField } from '../features/place/PlaceField';
import type { PlaceRef } from '../domain/types';

export function QuickCreate() {
  const { gateway, snapshot, refresh, announce, can, executeQueueable } = useApp();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'todo' | 'event' | 'expense'>('todo');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [place, setPlace] = useState<PlaceRef | null>(null);
  const kinds = useMemo(() => ([['todo','タスク','task.create'],['event','予定','event.create'],['expense','支出','expense.create']] as const).filter(([, , capability]) => can(capability)), [can]);
  useEffect(() => {
    const openRequested = (event: Event) => {
      const requested = (event as CustomEvent<{ kind?: 'todo' | 'event' | 'expense' }>).detail.kind;
      const availableKind = requested && kinds.some(([value]) => value === requested) ? requested : kinds[0]?.[0];
      if (availableKind) { setKind(availableKind); setPlace(null); setOpen(true); }
    };
    window.addEventListener('family-hub:quick-create', openRequested);
    return () => window.removeEventListener('family-hub:quick-create', openRequested);
  }, [kinds]);

  const submit = async (form: HTMLFormElement) => {
    if (submitting) return;
    setError(''); setSubmitting(true);
    const values = new FormData(form);
    const title = String(values.get('title') ?? '');
    if (kind === 'todo') {
      const input = { title, dueAt: '2026-09-30T20:00:00+09:00', assigneeMembershipId: String(values.get('member')) };
      const parsed = todoInputSchema.safeParse(input);
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '入力を確認してください'); setSubmitting(false); return; }
      const outcome = await executeQueueable({ operation: 'task.create', summary: `タスク「${title}」を作成`, payload: { input: parsed.data } }, () => gateway.todos.createTodo(parsed.data));
      if (outcome.status === 'failed') { setError(outcome.error.message); setSubmitting(false); return; }
      if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
    }
    if (kind === 'event') {
      const input = { title, startsAt: '2026-10-01T18:00:00+09:00', endsAt: '2026-10-01T19:00:00+09:00', timezone: 'Asia/Tokyo', participantMembershipIds: [String(values.get('member'))] };
      const outcome = await executeQueueable({ operation: 'event.create', summary: `予定「${title}」を作成`, payload: { input } }, () => gateway.events.createEvent(input));
      if (outcome.status === 'failed') { setError(outcome.error.message); setSubmitting(false); return; }
      if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
    }
    if (kind === 'expense') {
      const shareMembershipIds = values.getAll('shares').map(String);
      if (!shareMembershipIds.length) { setError('負担する人を1人以上選んでください。'); setSubmitting(false); return; }
      const result = await gateway.expenses.createExpense({ title, amountJpy: Number(values.get('amount')), incurredOn: '2026-09-30', payerMembershipId: String(values.get('member')), shareMembershipIds, ...(place ? { place } : {}) });
      if (!result.ok) { setError(`${result.error.message} 支出は未送信の変更として保存されません。`); setSubmitting(false); return; }
    }
    await refresh(); setOpen(false); setSubmitting(false); setPlace(null); announce(`${kind === 'todo' ? 'タスク' : kind === 'event' ? '予定' : '支出'}を追加しました`);
  };

  const titleLabel = kind === 'todo' ? 'タスク名' : kind === 'event' ? '予定名' : '支出名';
  const titleExample = kind === 'todo' ? '例：提出物を確認する' : kind === 'event' ? '例：家族で相談' : '例：学校教材';
  const memberLabel = kind === 'expense' ? '支払った人' : kind === 'todo' ? '担当者' : '参加者';
  return <><button type="button" className="button primary quick-create" data-control-id="quick-create.open" onClick={() => { setPlace(null); setOpen(true); }}><PlusIcon width="20" /><span>すぐに追加</span></button>{open && <Dialog title="すぐに追加" description="この画面を開いたまま、予定・タスク・支出を追加できます。" onClose={() => { if (!submitting) setOpen(false); }}><div className="segmented" aria-label="追加する項目">{kinds.map(([value,label]) => <button data-control-id={`quick-create.kind.${value}`} key={value} type="button" aria-pressed={kind === value} disabled={submitting} onClick={() => setKind(value)}>{label}</button>)}</div><form className="stack mt-1" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}><div className="field"><label htmlFor="quick-title">{titleLabel}</label><input data-control-id="quick-create.title" className="input" id="quick-title" name="title" required maxLength={120} autoFocus aria-describedby="quick-title-help"/><span className="field-help" id="quick-title-help">{titleExample}</span></div>{kind === 'expense' && <div className="field"><label htmlFor="quick-amount">金額（円）</label><input data-control-id="quick-create.amount" className="input" id="quick-amount" name="amount" type="number" min="1" step="1" required /></div>}<div className="field"><label htmlFor="quick-member">{memberLabel}</label><select data-control-id="quick-create.member" className="select" id="quick-member" name="member" defaultValue={snapshot.viewer.membershipId}>{snapshot.memberships.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></div>{kind === 'expense' && <fieldset className="fieldset"><legend>負担する人</legend><div className="choice-grid">{snapshot.memberships.filter((member) => member.role !== 'child' && member.role !== 'guest').map((member) => <label key={member.id}><input data-control-id={`quick-create.share.${member.id}`} type="checkbox" name="shares" value={member.id} defaultChecked/>{member.displayName}</label>)}</div></fieldset>}{kind === 'expense' && can('place.read') && <PlaceField value={place} onChange={setPlace} disabled={submitting}/>}<p className="field-help">このデモでは日時を固定しています。追加後に変更できます。</p>{error && <p className="field-error" role="alert">{error}</p>}<div className="dialog-actions"><button data-control-id="quick-create.cancel" className="button" type="button" disabled={submitting} onClick={() => setOpen(false)}>{ja.actions.cancel}</button><button data-control-id="quick-create.submit" className="button primary" type="submit" disabled={submitting}>{submitting ? '追加中…' : ja.actions.add}</button></div></form></Dialog>}</>;
}
