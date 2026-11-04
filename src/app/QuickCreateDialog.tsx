import { useRef, useState } from 'react';
import { useSubmission } from './useSubmission';
import { eventInputSchema, expenseInputSchema, memoInputSchema, todoInputSchema } from '../domain/schemas';
import { useApp, type QuickCreateKind, type QuickCreateSeed } from './AppContext';
import { Dialog } from '../design-system/components';
import { EyeIcon } from '../design-system/icons';
import { closeGuarded, useUnsavedGuard } from '../design-system/unsavedGuard';
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

const firstIssue = (issues: Array<{ message: string }>) => issues[0]?.message ?? '入力内容を確認してください。';

export interface QuickCreateDialogProps {
  kinds: ReadonlyArray<readonly [QuickCreateKind, string, Capability]>;
  kind: QuickCreateKind;
  onKind: (kind: QuickCreateKind) => void;
  prefill: EventPrefill | null;
  expenseKind: Expense['kind'];
  seed: QuickCreateSeed | null;
  onClose: () => void;
}

/** すぐに追加のダイアログ。フォームと入力の確かめは重いので、開いたときに読む（QuickCreate.tsx から遅れて読む）。 */
export default function QuickCreateDialog({ kinds, kind, onKind, prefill, expenseKind, seed, onClose }: QuickCreateDialogProps) {
  const { gateway, snapshot, refresh, announce, can, executeQueueable, privacy } = useApp();
  const [error, setError] = useState('');
  // 送信中の印と、このダイアログを開いている間の1つの冪等キー。種類を切り替えても同じダイアログなので同じキーを使う（送るのは1回だけ）。
  const submission = useSubmission();
  const { submitting, idempotencyKey } = submission;
  const context = { idempotencyKey, expectedPermissionRevision: snapshot.viewer.permissionRevision };
  const [place, setPlace] = useState<PlaceRef | null>(null);
  // メモの入力は送るときに読むので、触ったかどうかだけを覚える。
  const [memoTouched, setMemoTouched] = useState(false);
  const memoUnsaved = useUnsavedGuard(kind === 'memo' && (memoTouched || Boolean(place)), submitting);
  const forms = useRef<HTMLDivElement>(null);
  const today = dateKeyFromRfc3339(snapshot.context.asOf);
  const adultIds = activeAdults(snapshot.memberships).map((member) => member.id);
  const setOpen = (value: false) => { if (!value) onClose(); };

  const finish = async (label: string) => { await refresh(); setOpen(false); submission.end(); setPlace(null); announce(`${label}を追加しました`); };
  const submit = async (form: HTMLFormElement) => {
    if (!submission.start()) return;
    setError('');
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? '');
    const title = text('title');
    const stop = (message: string) => { setError(message); submission.end(); };
    const parsed = memoInputSchema.safeParse({ title, body: text('body'), tags: text('tags').split(/[,、]/).map((tag) => tag.trim()).filter(Boolean), ...(place ? { place } : {}) });
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const outcome = await executeQueueable({ operation: 'memo.create', summary: `メモ「${title}」を作成`, payload: { input: parsed.data } }, () => gateway.memos.createMemo(parsed.data, context), idempotencyKey);
    if (outcome.status === 'failed') return stop(outcome.error.message);
    if (outcome.status === 'queued') { setOpen(false); submission.end(); return; }
    return finish('メモ');
  };

  const submitEvent = async (draft: EventDraft) => {
    if (!submission.start()) return;
    setError('');
    const stop = (message: string) => { setError(message); submission.end(); };
    const parsed = eventInputSchema.safeParse(draftToCreateInput(draft));
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const outcome = await executeQueueable({ operation: 'event.create', summary: `予定「${parsed.data.title}」を作成`, payload: { input: parsed.data } }, () => gateway.events.createEvent(parsed.data, context), idempotencyKey);
    if (outcome.status === 'failed') return stop(outcome.error.message);
    if (outcome.status === 'queued') { setOpen(false); submission.end(); return; }
    return finish('予定');
  };
  const submitTask = async (draft: TaskDraft) => {
    if (!submission.start()) return;
    setError('');
    const stop = (message: string) => { setError(message); submission.end(); };
    const parsed = todoInputSchema.safeParse(taskDraftToCreateInput(draft));
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const outcome = await executeQueueable({ operation: 'task.create', summary: `タスク「${parsed.data.title}」を作成`, payload: { input: parsed.data } }, () => gateway.todos.createTodo(parsed.data, context), idempotencyKey);
    if (outcome.status === 'failed') return stop(outcome.error.message);
    if (outcome.status === 'queued') { setOpen(false); submission.end(); return; }
    return finish('タスク');
  };
  const submitExpense = async (draft: ExpenseDraft) => {
    if (!submission.start()) return;
    setError('');
    const label = ja.expenseKind[draft.kind];
    const stop = (message: string) => { setError(message); submission.end(); };
    const parsed = expenseInputSchema.safeParse(expenseDraftToCreateInput(draft, adultIds));
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const result = await gateway.expenses.createExpense(parsed.data, idempotencyKey);
    if (!result.ok) return stop(`${result.error.message} ${label}は未送信の変更として保存されません。`);
    return finish(label);
  };
  const { role, membershipId } = snapshot.viewer;
  return <Dialog title="すぐに追加" description="この画面を開いたまま、予定・タスク・メモ・家計の記録を追加できます。" onClose={() => { if (!submitting) setOpen(false); }}>
      <div className="segmented" role="group" aria-label="追加する項目">{kinds.map(([value, label]) => <button data-control-id={`quick-create.kind.${value}`} key={value} type="button" aria-pressed={kind === value} disabled={submitting} onClick={() => closeGuarded(forms.current, () => { onKind(value); setError(''); setMemoTouched(false); setPlace(null); })}>{label}</button>)}</div>
      {seed?.note && <div className="callout info mt-1" role="status"><EyeIcon/><p className="small mb-0">{seed.note}</p></div>}
      <div ref={forms}>
      {kind === 'event' && <div className="mt-1"><EventForm formId="new" initial={{ ...newEventDraft(prefill ?? { date: today }, membershipId, defaultAudience(role, 'event', privacy?.defaultAudience)), ...seed?.event }} submitLabel={ja.actions.add} busy={submitting} error={error} offerTemplates onSubmit={(draft) => void submitEvent(draft)} onCancel={() => setOpen(false)}/></div>}
      {kind === 'todo' && <div className="mt-1"><TaskForm formId="new" initial={{ ...newTaskDraft(today, membershipId, defaultAudience(role, 'task', privacy?.defaultAudience)), ...seed?.todo }} submitLabel={ja.actions.add} busy={submitting} error={error} onSubmit={(draft) => void submitTask(draft)} onCancel={() => setOpen(false)}/></div>}
      {kind === 'expense' && <div className="mt-1"><ExpenseForm formId="new" initial={{ ...newExpenseDraft(today, membershipId, adultIds, defaultAudience(role, 'expense', privacy?.defaultAudience), expenseKind), ...seed?.expense }} splitLocked={false} submitLabel={ja.actions.add} busy={submitting} error={error} onSubmit={(draft) => void submitExpense(draft)} onCancel={() => setOpen(false)}/></div>}
      {kind === 'memo' && <form {...memoUnsaved.formProps} className="stack mt-1" aria-busy={submitting} onInput={() => setMemoTouched(true)} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
        <div className="field"><label htmlFor="quick-title">タイトル</label><input data-control-id="quick-create.title" className="input" id="quick-title" name="title" required maxLength={120} autoFocus aria-describedby="quick-title-help"/><span className="field-help" id="quick-title-help">例：学校からのお知らせ</span></div>
        <div className="field"><label htmlFor="quick-body">本文</label><textarea data-control-id="quick-create.body" className="textarea" id="quick-body" name="body" required maxLength={5000}/></div>
        <div className="field"><label htmlFor="quick-tags">タグ（任意）</label><input data-control-id="quick-create.tags" className="input" id="quick-tags" name="tags" aria-describedby="quick-tags-help"/><span className="field-help" id="quick-tags-help">読点またはカンマで区切ります（最大10件）</span></div>
        {can('place.read') && <PlaceField value={place} onChange={setPlace} disabled={submitting}/>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button data-control-id="quick-create.cancel" className="button" type="button" disabled={submitting} onClick={() => memoUnsaved.leave(() => setOpen(false))}>{ja.actions.cancel}</button><button data-control-id="quick-create.submit" className="button primary" type="submit" disabled={submitting}>{submitting ? '追加中…' : ja.actions.add}</button></div>
      </form>}
      </div>
    </Dialog>;
}
