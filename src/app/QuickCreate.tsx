import { useEffect, useMemo, useState } from 'react';
import { eventInputSchema, expenseInputSchema, memoInputSchema, todoInputSchema } from '../domain/schemas';
import { useApp, type QuickCreateKind } from './AppContext';
import { Dialog } from '../design-system/components';
import { PlusIcon } from '../design-system/icons';
import { ja } from '../content/ja';
import { dateKeyFromRfc3339 } from '../domain/calendarDate';
import { draftToCreateInput, newEventDraft, type EventDraft, type EventPrefill } from '../domain/eventForm';
import { activeAdults, expenseDraftToCreateInput, newExpenseDraft, type ExpenseDraft } from '../domain/expenseForm';
import { newTaskDraft, taskDraftToCreateInput, type TaskDraft } from '../domain/taskForm';
import { defaultAudience } from '../domain/visibilityForm';
import { EventForm } from '../features/calendar/EventForm';
import { ExpenseForm } from '../features/budget/ExpenseForm';
import { TaskForm } from '../features/tasks/TaskForm';
import { PlaceField } from '../features/place/PlaceField';
import type { Capability, Expense, PlaceRef } from '../domain/types';

const kindTable: ReadonlyArray<readonly [QuickCreateKind, string, Capability]> = [['todo', 'タスク', 'task.create'], ['event', '予定', 'event.create'], ['memo', 'メモ', 'memo.create'], ['expense', '家計', 'expense.create']];
const firstIssue = (issues: Array<{ message: string }>) => issues[0]?.message ?? '入力内容を確認してください。';

export function QuickCreate() {
  const { gateway, snapshot, refresh, announce, can, executeQueueable, privacy } = useApp();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QuickCreateKind>('todo');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [place, setPlace] = useState<PlaceRef | null>(null);
  const [prefill, setPrefill] = useState<EventPrefill | null>(null);
  const [expenseKind, setExpenseKind] = useState<Expense['kind']>('expense');
  const kinds = useMemo(() => kindTable.filter(([, , capability]) => can(capability)), [can]);
  const today = dateKeyFromRfc3339(snapshot.context.asOf);
  const adultIds = activeAdults(snapshot.memberships).map((member) => member.id);

  // 開くたびに、要求された種類（なければ使える最初の種類）へ戻す。使えない種類のまま開かない。
  const openWith = (requested?: QuickCreateKind, eventPrefill?: EventPrefill, requestedExpenseKind?: Expense['kind']) => {
    const next = requested && kinds.some(([value]) => value === requested) ? requested : kinds[0]?.[0];
    if (!next) return;
    setKind(next); setPlace(null); setPrefill(eventPrefill ?? null); setExpenseKind(requestedExpenseKind ?? 'expense'); setError(''); setOpen(true);
  };
  useEffect(() => {
    const openRequested = (event: Event) => { const { kind: requested, prefill: eventPrefill, expenseKind: requestedExpenseKind } = (event as CustomEvent<{ kind?: QuickCreateKind; prefill?: EventPrefill; expenseKind?: Expense['kind'] }>).detail; openWith(requested, eventPrefill, requestedExpenseKind); };
    window.addEventListener('family-hub:quick-create', openRequested);
    return () => window.removeEventListener('family-hub:quick-create', openRequested);
  });

  const finish = async (label: string) => { await refresh(); setOpen(false); setSubmitting(false); setPlace(null); announce(`${label}を追加しました`); };
  const submit = async (form: HTMLFormElement) => {
    if (submitting) return;
    setError(''); setSubmitting(true);
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? '');
    const title = text('title');
    const stop = (message: string) => { setError(message); setSubmitting(false); };
    const parsed = memoInputSchema.safeParse({ title, body: text('body'), tags: text('tags').split(/[,、]/).map((tag) => tag.trim()).filter(Boolean), ...(place ? { place } : {}) });
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const outcome = await executeQueueable({ operation: 'memo.create', summary: `メモ「${title}」を作成`, payload: { input: parsed.data } }, () => gateway.memos.createMemo(parsed.data));
    if (outcome.status === 'failed') return stop(outcome.error.message);
    if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
    return finish('メモ');
  };

  const submitEvent = async (draft: EventDraft) => {
    if (submitting) return;
    setError(''); setSubmitting(true);
    const stop = (message: string) => { setError(message); setSubmitting(false); };
    const parsed = eventInputSchema.safeParse(draftToCreateInput(draft));
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const outcome = await executeQueueable({ operation: 'event.create', summary: `予定「${parsed.data.title}」を作成`, payload: { input: parsed.data } }, () => gateway.events.createEvent(parsed.data));
    if (outcome.status === 'failed') return stop(outcome.error.message);
    if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
    return finish('予定');
  };
  const submitTask = async (draft: TaskDraft) => {
    if (submitting) return;
    setError(''); setSubmitting(true);
    const stop = (message: string) => { setError(message); setSubmitting(false); };
    const parsed = todoInputSchema.safeParse(taskDraftToCreateInput(draft));
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const outcome = await executeQueueable({ operation: 'task.create', summary: `タスク「${parsed.data.title}」を作成`, payload: { input: parsed.data } }, () => gateway.todos.createTodo(parsed.data));
    if (outcome.status === 'failed') return stop(outcome.error.message);
    if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
    return finish('タスク');
  };
  const submitExpense = async (draft: ExpenseDraft) => {
    if (submitting) return;
    setError(''); setSubmitting(true);
    const label = ja.expenseKind[draft.kind];
    const stop = (message: string) => { setError(message); setSubmitting(false); };
    const parsed = expenseInputSchema.safeParse(expenseDraftToCreateInput(draft, adultIds));
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const result = await gateway.expenses.createExpense(parsed.data);
    if (!result.ok) return stop(`${result.error.message} ${label}は未送信の変更として保存されません。`);
    return finish(label);
  };
  const { role, membershipId } = snapshot.viewer;
  return <>
    <button type="button" className="button primary quick-create" data-control-id="quick-create.open" onClick={() => openWith()}><PlusIcon width="20"/><span>すぐに追加</span></button>
    {open && <Dialog title="すぐに追加" description="この画面を開いたまま、予定・タスク・メモ・家計の記録を追加できます。" onClose={() => { if (!submitting) setOpen(false); }}>
      <div className="segmented" role="group" aria-label="追加する項目">{kinds.map(([value, label]) => <button data-control-id={`quick-create.kind.${value}`} key={value} type="button" aria-pressed={kind === value} disabled={submitting} onClick={() => { setKind(value); setError(''); }}>{label}</button>)}</div>
      {kind === 'event' && <div className="mt-1"><EventForm formId="new" initial={newEventDraft(prefill ?? { date: today }, membershipId, defaultAudience(role, 'event', privacy?.defaultAudience))} submitLabel={ja.actions.add} busy={submitting} error={error} offerTemplates onSubmit={(draft) => void submitEvent(draft)} onCancel={() => setOpen(false)}/></div>}
      {kind === 'todo' && <div className="mt-1"><TaskForm formId="new" initial={newTaskDraft(today, membershipId, defaultAudience(role, 'task', privacy?.defaultAudience))} submitLabel={ja.actions.add} busy={submitting} error={error} onSubmit={(draft) => void submitTask(draft)} onCancel={() => setOpen(false)}/></div>}
      {kind === 'expense' && <div className="mt-1"><ExpenseForm formId="new" initial={newExpenseDraft(today, membershipId, adultIds, defaultAudience(role, 'expense', privacy?.defaultAudience), expenseKind)} splitLocked={false} submitLabel={ja.actions.add} busy={submitting} error={error} onSubmit={(draft) => void submitExpense(draft)} onCancel={() => setOpen(false)}/></div>}
      {kind === 'memo' && <form className="stack mt-1" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
        <div className="field"><label htmlFor="quick-title">タイトル</label><input data-control-id="quick-create.title" className="input" id="quick-title" name="title" required maxLength={120} autoFocus aria-describedby="quick-title-help"/><span className="field-help" id="quick-title-help">例：学校からのお知らせ</span></div>
        <div className="field"><label htmlFor="quick-body">本文</label><textarea data-control-id="quick-create.body" className="textarea" id="quick-body" name="body" required maxLength={5000}/></div>
        <div className="field"><label htmlFor="quick-tags">タグ（任意）</label><input data-control-id="quick-create.tags" className="input" id="quick-tags" name="tags" aria-describedby="quick-tags-help"/><span className="field-help" id="quick-tags-help">読点またはカンマで区切ります（最大10件）</span></div>
        {can('place.read') && <PlaceField value={place} onChange={setPlace} disabled={submitting}/>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button data-control-id="quick-create.cancel" className="button" type="button" disabled={submitting} onClick={() => setOpen(false)}>{ja.actions.cancel}</button><button data-control-id="quick-create.submit" className="button primary" type="submit" disabled={submitting}>{submitting ? '追加中…' : ja.actions.add}</button></div>
      </form>}
    </Dialog>}
  </>;
}
