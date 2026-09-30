import { useState } from 'react';
import { todoInputSchema } from '../domain/schemas';
import { useApp } from './AppContext';
import { Dialog } from '../design-system/components';
import { PlusIcon } from '../design-system/icons';

export function QuickCreate() {
  const { gateway, snapshot, refresh, announce } = useApp();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'todo' | 'event' | 'expense'>('todo');
  const [error, setError] = useState('');

  const submit = async (form: HTMLFormElement) => {
    setError('');
    const values = new FormData(form);
    const title = String(values.get('title') ?? '');
    if (kind === 'todo') {
      const input = { title, dueAt: '2026-09-30T20:00:00+09:00', assigneeMembershipId: String(values.get('member')) };
      const parsed = todoInputSchema.safeParse(input);
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '入力を確認してください'); return; }
      const result = await gateway.todos.createTodo(parsed.data);
      if (!result.ok) { setError(result.error.message); return; }
    }
    if (kind === 'event') {
      const result = await gateway.events.createEvent({ title, startsAt: '2026-10-01T18:00:00+09:00', endsAt: '2026-10-01T19:00:00+09:00', timezone: 'Asia/Tokyo', participantMembershipIds: [String(values.get('member'))] });
      if (!result.ok) { setError(result.error.message); return; }
    }
    if (kind === 'expense') {
      const result = await gateway.expenses.createExpense({ title, amountJpy: Number(values.get('amount')), incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', shareMembershipIds: ['member-aoi', 'member-ren'] });
      if (!result.ok) { setError(result.error.message); return; }
    }
    await refresh(); setOpen(false); announce(`${kind === 'todo' ? 'Todo' : kind === 'event' ? '予定' : '支出'}を追加しました`);
  };

  return <><button type="button" className="button primary quick-create" onClick={() => setOpen(true)}><PlusIcon width="20" /><span>クイック作成</span></button>{open && <Dialog title="クイック作成" description="予定・Todo・支出を、今の画面から離れず追加します。" onClose={() => setOpen(false)}><div className="segmented" aria-label="作成する種類">{([['todo','Todo'],['event','予定'],['expense','支出']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}</div><form className="stack mt-1" onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}><div className="field"><label htmlFor="quick-title">{kind === 'todo' ? 'すること' : kind === 'event' ? '予定名' : '支出名'}</label><input className="input" id="quick-title" name="title" required maxLength={120} autoFocus placeholder={kind === 'todo' ? '例：提出物を確認する' : kind === 'event' ? '例：家族で相談' : '例：学校教材'} /></div>{kind === 'expense' && <div className="field"><label htmlFor="quick-amount">金額（円）</label><input className="input" id="quick-amount" name="amount" type="number" min="1" step="1" required /></div>}<div className="field"><label htmlFor="quick-member">{kind === 'expense' ? '支払った人（デモは碧）' : '担当・参加者'}</label><select className="select" id="quick-member" name="member" defaultValue="member-aoi">{snapshot.memberships.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></div><p className="field-help">日時はデモ用の固定値です。詳細画面から編集できます。</p>{error && <p className="field-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button" type="button" onClick={() => setOpen(false)}>キャンセル</button><button className="button primary" type="submit">追加する</button></div></form></Dialog>}</>;
}
