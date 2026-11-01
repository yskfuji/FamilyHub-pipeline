import { useEffect, useMemo, useState } from 'react';
import { eventInputSchema, expenseInputSchema, memoInputSchema, todoInputSchema } from '../domain/schemas';
import { useApp, type QuickCreateKind } from './AppContext';
import { Dialog } from '../design-system/components';
import { PlusIcon } from '../design-system/icons';
import { ja } from '../content/ja';
import { dateKeyFromRfc3339 } from '../domain/calendarDate';
import { expenseCategories } from '../domain/ledger';
import { draftToCreateInput, newEventDraft, type EventDraft, type EventPrefill } from '../domain/eventForm';
import { newTaskDraft, taskDraftToCreateInput, type TaskDraft } from '../domain/taskForm';
import { defaultAudience } from '../domain/visibilityForm';
import { EventForm } from '../features/calendar/EventForm';
import { TaskForm } from '../features/tasks/TaskForm';
import { PlaceField } from '../features/place/PlaceField';
import type { Capability, Expense, PlaceRef } from '../domain/types';

const kindTable: ReadonlyArray<readonly [QuickCreateKind, string, Capability]> = [['todo', 'タスク', 'task.create'], ['event', '予定', 'event.create'], ['memo', 'メモ', 'memo.create'], ['expense', '支出', 'expense.create']];
const firstIssue = (issues: Array<{ message: string }>) => issues[0]?.message ?? '入力内容を確認してください。';

export function QuickCreate() {
  const { gateway, snapshot, refresh, announce, can, executeQueueable, privacy } = useApp();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QuickCreateKind>('todo');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [place, setPlace] = useState<PlaceRef | null>(null);
  const [prefill, setPrefill] = useState<EventPrefill | null>(null);
  const kinds = useMemo(() => kindTable.filter(([, , capability]) => can(capability)), [can]);
  const today = dateKeyFromRfc3339(snapshot.context.asOf);
  const active = snapshot.memberships.filter((member) => member.status === 'active');
  const adults = active.filter((member) => member.role === 'owner' || member.role === 'adult');

  // 開くたびに、要求された種類（なければ使える最初の種類）へ戻す。使えない種類のまま開かない。
  const openWith = (requested?: QuickCreateKind, eventPrefill?: EventPrefill) => {
    const next = requested && kinds.some(([value]) => value === requested) ? requested : kinds[0]?.[0];
    if (!next) return;
    setKind(next); setPlace(null); setPrefill(eventPrefill ?? null); setError(''); setOpen(true);
  };
  useEffect(() => {
    const openRequested = (event: Event) => { const { kind: requested, prefill: eventPrefill } = (event as CustomEvent<{ kind?: QuickCreateKind; prefill?: EventPrefill }>).detail; openWith(requested, eventPrefill); };
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
    if (kind === 'memo') {
      const parsed = memoInputSchema.safeParse({ title, body: text('body'), tags: text('tags').split(/[,、]/).map((tag) => tag.trim()).filter(Boolean), ...(place ? { place } : {}) });
      if (!parsed.success) return stop(firstIssue(parsed.error.issues));
      const outcome = await executeQueueable({ operation: 'memo.create', summary: `メモ「${title}」を作成`, payload: { input: parsed.data } }, () => gateway.memos.createMemo(parsed.data));
      if (outcome.status === 'failed') return stop(outcome.error.message);
      if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
      return finish('メモ');
    }
    const parsed = expenseInputSchema.safeParse({ title, amountJpy: Number(text('amount')), incurredOn: text('date'), payerMembershipId: text('member'), shareMembershipIds: values.getAll('shares').map(String), category: text('category') as Expense['category'], ...(text('note').trim() ? { note: text('note').trim() } : {}), ...(place ? { place } : {}) });
    if (!parsed.success) return stop(firstIssue(parsed.error.issues));
    const result = await gateway.expenses.createExpense(parsed.data);
    if (!result.ok) return stop(`${result.error.message} 支出は未送信の変更として保存されません。`);
    return finish('支出');
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
  const titleLabel = kind === 'memo' ? 'タイトル' : '支出名';
  const titleExample = kind === 'memo' ? '例：学校からのお知らせ' : '例：学校教材';
  const { role, membershipId } = snapshot.viewer;
  return <>
    <button type="button" className="button primary quick-create" data-control-id="quick-create.open" onClick={() => openWith()}><PlusIcon width="20"/><span>すぐに追加</span></button>
    {open && <Dialog title="すぐに追加" description="この画面を開いたまま、予定・タスク・メモ・支出を追加できます。" onClose={() => { if (!submitting) setOpen(false); }}>
      <div className="segmented" role="group" aria-label="追加する項目">{kinds.map(([value, label]) => <button data-control-id={`quick-create.kind.${value}`} key={value} type="button" aria-pressed={kind === value} disabled={submitting} onClick={() => { setKind(value); setError(''); }}>{label}</button>)}</div>
      {kind === 'event' && <div className="mt-1"><EventForm formId="new" initial={newEventDraft(prefill ?? { date: today }, membershipId, defaultAudience(role, 'event', privacy?.defaultAudience))} submitLabel={ja.actions.add} busy={submitting} error={error} offerTemplates onSubmit={(draft) => void submitEvent(draft)} onCancel={() => setOpen(false)}/></div>}
      {kind === 'todo' && <div className="mt-1"><TaskForm formId="new" initial={newTaskDraft(today, membershipId, defaultAudience(role, 'task', privacy?.defaultAudience))} submitLabel={ja.actions.add} busy={submitting} error={error} onSubmit={(draft) => void submitTask(draft)} onCancel={() => setOpen(false)}/></div>}
      {(kind === 'memo' || kind === 'expense') && <form key={kind} className="stack mt-1" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
        <div className="field"><label htmlFor="quick-title">{titleLabel}</label><input data-control-id="quick-create.title" className="input" id="quick-title" name="title" required maxLength={120} autoFocus aria-describedby="quick-title-help"/><span className="field-help" id="quick-title-help">{titleExample}</span></div>
        {kind === 'memo' && <>
          <div className="field"><label htmlFor="quick-body">本文</label><textarea data-control-id="quick-create.body" className="textarea" id="quick-body" name="body" required maxLength={5000}/></div>
          <div className="field"><label htmlFor="quick-tags">タグ（任意）</label><input data-control-id="quick-create.tags" className="input" id="quick-tags" name="tags" aria-describedby="quick-tags-help"/><span className="field-help" id="quick-tags-help">読点またはカンマで区切ります（最大10件）</span></div>
          {can('place.read') && <PlaceField value={place} onChange={setPlace} disabled={submitting}/>}
        </>}
        {kind === 'expense' && <>
          <div className="grid two">
            <div className="field"><label htmlFor="quick-amount">金額（円）</label><input data-control-id="quick-create.amount" className="input" id="quick-amount" name="amount" type="number" min="1" step="1" required inputMode="numeric"/></div>
            <div className="field"><label htmlFor="quick-date">日付</label><input data-control-id="quick-create.date" className="input" id="quick-date" name="date" type="date" required defaultValue={today}/></div>
          </div>
          <div className="grid two">
            <div className="field"><label htmlFor="quick-category">費目</label><select data-control-id="quick-create.category" className="select" id="quick-category" name="category" defaultValue="other">{expenseCategories.map((category) => <option key={category} value={category}>{ja.expenseCategory[category]}</option>)}</select></div>
            <div className="field"><label htmlFor="quick-member">支払った人</label><select data-control-id="quick-create.member" className="select" id="quick-member" name="member" defaultValue={adults.some((member) => member.id === snapshot.viewer.membershipId) ? snapshot.viewer.membershipId : adults[0]?.id}>{adults.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></div>
          </div>
          <fieldset className="fieldset"><legend>負担する人</legend><div className="choice-grid">{adults.map((member) => <label key={member.id}><input data-control-id={`quick-create.share.${member.id}`} type="checkbox" name="shares" value={member.id} defaultChecked/>{member.displayName}</label>)}</div></fieldset>
          <div className="field"><label htmlFor="quick-note">メモ（任意）</label><input data-control-id="quick-create.note" className="input" id="quick-note" name="note" maxLength={500}/></div>
          {can('place.read') && <PlaceField value={place} onChange={setPlace} disabled={submitting}/>}
        </>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button data-control-id="quick-create.cancel" className="button" type="button" disabled={submitting} onClick={() => setOpen(false)}>{ja.actions.cancel}</button><button data-control-id="quick-create.submit" className="button primary" type="submit" disabled={submitting}>{submitting ? '追加中…' : ja.actions.add}</button></div>
      </form>}
    </Dialog>}
  </>;
}
