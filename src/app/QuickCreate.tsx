import { useEffect, useMemo, useState } from 'react';
import { eventInputSchema, expenseInputSchema, memoInputSchema, todoInputSchema } from '../domain/schemas';
import { useApp, type QuickCreateKind } from './AppContext';
import { Dialog } from '../design-system/components';
import { PlusIcon } from '../design-system/icons';
import { ja } from '../content/ja';
import { dateKeyFromRfc3339 } from '../domain/calendarDate';
import { expenseCategories } from '../domain/ledger';
import { PlaceField } from '../features/place/PlaceField';
import type { Capability, Expense, PlaceRef } from '../domain/types';

const kindTable: ReadonlyArray<readonly [QuickCreateKind, string, Capability]> = [['todo', 'タスク', 'task.create'], ['event', '予定', 'event.create'], ['memo', 'メモ', 'memo.create'], ['expense', '支出', 'expense.create']];
const jst = (date: string, time: string) => `${date}T${time}:00+09:00`;
const firstIssue = (issues: Array<{ message: string }>) => issues[0]?.message ?? '入力内容を確認してください。';

export function QuickCreate() {
  const { gateway, snapshot, refresh, announce, can, executeQueueable } = useApp();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QuickCreateKind>('todo');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [place, setPlace] = useState<PlaceRef | null>(null);
  const kinds = useMemo(() => kindTable.filter(([, , capability]) => can(capability)), [can]);
  const today = dateKeyFromRfc3339(snapshot.context.asOf);
  const active = snapshot.memberships.filter((member) => member.status === 'active');
  const adults = active.filter((member) => member.role === 'owner' || member.role === 'adult');

  // 開くたびに、要求された種類（なければ使える最初の種類）へ戻す。使えない種類のまま開かない。
  const openWith = (requested?: QuickCreateKind) => {
    const next = requested && kinds.some(([value]) => value === requested) ? requested : kinds[0]?.[0];
    if (!next) return;
    setKind(next); setPlace(null); setError(''); setOpen(true);
  };
  useEffect(() => {
    const openRequested = (event: Event) => openWith((event as CustomEvent<{ kind?: QuickCreateKind }>).detail.kind);
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
    if (kind === 'todo') {
      const parsed = todoInputSchema.safeParse({ title, dueAt: jst(text('date'), text('time')), assigneeMembershipId: text('member'), ...(text('reviewer') ? { reviewerMembershipId: text('reviewer') } : {}) });
      if (!parsed.success) return stop(firstIssue(parsed.error.issues));
      const outcome = await executeQueueable({ operation: 'task.create', summary: `タスク「${title}」を作成`, payload: { input: parsed.data } }, () => gateway.todos.createTodo(parsed.data));
      if (outcome.status === 'failed') return stop(outcome.error.message);
      if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
      return finish('タスク');
    }
    if (kind === 'event') {
      const parsed = eventInputSchema.safeParse({ title, startsAt: jst(text('date'), text('start')), endsAt: jst(text('date'), text('end')), timezone: 'Asia/Tokyo', participantMembershipIds: values.getAll('participants').map(String), ...(text('location').trim() ? { location: text('location').trim() } : {}) });
      if (!parsed.success) return stop(firstIssue(parsed.error.issues));
      const outcome = await executeQueueable({ operation: 'event.create', summary: `予定「${title}」を作成`, payload: { input: parsed.data } }, () => gateway.events.createEvent(parsed.data));
      if (outcome.status === 'failed') return stop(outcome.error.message);
      if (outcome.status === 'queued') { setOpen(false); setSubmitting(false); return; }
      return finish('予定');
    }
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

  const titleLabel = kind === 'todo' ? 'タスク名' : kind === 'event' ? '予定名' : kind === 'memo' ? 'タイトル' : '支出名';
  const titleExample = kind === 'todo' ? '例：提出物を確認する' : kind === 'event' ? '例：家族で相談' : kind === 'memo' ? '例：学校からのお知らせ' : '例：学校教材';
  return <>
    <button type="button" className="button primary quick-create" data-control-id="quick-create.open" onClick={() => openWith()}><PlusIcon width="20"/><span>すぐに追加</span></button>
    {open && <Dialog title="すぐに追加" description="この画面を開いたまま、予定・タスク・メモ・支出を追加できます。" onClose={() => { if (!submitting) setOpen(false); }}>
      <div className="segmented" role="group" aria-label="追加する項目">{kinds.map(([value, label]) => <button data-control-id={`quick-create.kind.${value}`} key={value} type="button" aria-pressed={kind === value} disabled={submitting} onClick={() => { setKind(value); setError(''); }}>{label}</button>)}</div>
      <form key={kind} className="stack mt-1" aria-busy={submitting} onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
        <div className="field"><label htmlFor="quick-title">{titleLabel}</label><input data-control-id="quick-create.title" className="input" id="quick-title" name="title" required maxLength={120} autoFocus aria-describedby="quick-title-help"/><span className="field-help" id="quick-title-help">{titleExample}</span></div>
        {kind === 'todo' && <>
          <div className="grid two">
            <div className="field"><label htmlFor="quick-date">期限の日付</label><input data-control-id="quick-create.date" className="input" id="quick-date" name="date" type="date" required defaultValue={today}/></div>
            <div className="field"><label htmlFor="quick-time">期限の時刻</label><input data-control-id="quick-create.time" className="input" id="quick-time" name="time" type="time" required defaultValue="20:00"/></div>
          </div>
          <div className="grid two">
            <div className="field"><label htmlFor="quick-member">担当者</label><select data-control-id="quick-create.member" className="select" id="quick-member" name="member" defaultValue={snapshot.viewer.membershipId}>{active.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></div>
            <div className="field"><label htmlFor="quick-reviewer">確認する人（任意）</label><select data-control-id="quick-create.reviewer" className="select" id="quick-reviewer" name="reviewer" defaultValue=""><option value="">なし</option>{adults.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></div>
          </div>
        </>}
        {kind === 'event' && <>
          <div className="grid three">
            <div className="field"><label htmlFor="quick-date">日付</label><input data-control-id="quick-create.date" className="input" id="quick-date" name="date" type="date" required defaultValue={today}/></div>
            <div className="field"><label htmlFor="quick-start">開始</label><input data-control-id="quick-create.start" className="input" id="quick-start" name="start" type="time" required defaultValue="18:00"/></div>
            <div className="field"><label htmlFor="quick-end">終了</label><input data-control-id="quick-create.end" className="input" id="quick-end" name="end" type="time" required defaultValue="19:00"/></div>
          </div>
          <div className="field"><label htmlFor="quick-location">場所（任意）</label><input data-control-id="quick-create.location" className="input" id="quick-location" name="location" maxLength={200}/></div>
          <fieldset className="fieldset"><legend>参加者</legend><div className="choice-grid">{active.map((member) => <label key={member.id}><input data-control-id={`quick-create.participant.${member.id}`} type="checkbox" name="participants" value={member.id} defaultChecked={member.id === snapshot.viewer.membershipId}/>{member.displayName}</label>)}</div></fieldset>
        </>}
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
      </form>
    </Dialog>}
  </>;
}
