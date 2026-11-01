import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { ja } from '../../content/ja';
import { Dialog } from '../../design-system/components';
import type { HouseholdMembership } from '../../domain/types';

type Action = 'transfer' | 'suspend' | 'resume' | 'remove';

const titles: Record<Action, (name: string) => string> = {
  transfer: (name) => `${name}さんに管理者を渡しますか`,
  suspend: (name) => `${name}さんを一時停止しますか`,
  resume: (name) => `${name}さんの一時停止を解除しますか`,
  remove: (name) => `${name}さんを家族グループから外しますか`,
};
const descriptions: Record<Action, string> = {
  transfer: '渡すと、あなたは大人のメンバーになり、メンバーの管理はできなくなります。元に戻すには、新しい管理者に渡し直してもらいます。',
  suspend: '一時停止の間は、この人は家族の情報を表示できません。記録は残ります。',
  resume: 'もう一度、家族の情報を表示できるようになります。',
  remove: 'この人は家族の情報を表示できなくなります。作った記録は残ります。もう一度参加するには、新しい招待コードが必要です。',
};
const confirmLabels: Record<Action, string> = { transfer: '管理者を渡す', suspend: '一時停止する', resume: '解除する', remove: '外す' };
const doneMessages: Record<Action, (name: string) => string> = {
  transfer: (name) => `${name}さんに管理者を渡しました。`,
  suspend: (name) => `${name}さんを一時停止しました。`,
  resume: (name) => `${name}さんの一時停止を解除しました。`,
  remove: (name) => `${name}さんを家族グループから外しました。`,
};

/** 権限の画面の下に置く、メンバーの管理。本人と管理者には行えないので出さない。 */
export function MemberActions({ member, onDone }: { member: HouseholdMembership; onDone: () => void }) {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const self = member.id === snapshot.viewer.membershipId;
  const owner = snapshot.viewer.role === 'owner';
  if (self || member.role === 'owner') return null;
  const canTransfer = owner && member.role === 'adult' && member.status === 'active';
  const suspended = member.status === 'suspended';
  const run = async () => {
    if (!action || busy) return;
    setBusy(true); setError('');
    const result = action === 'transfer' ? await gateway.family.transferOwnership(member.id, member.version)
      : action === 'remove' ? await gateway.family.removeMember(member.id, member.version)
        : await gateway.family.setMemberStatus(member.id, action === 'suspend' ? 'suspended' : 'active', member.version);
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    const done = doneMessages[action](member.displayName);
    setAction(null);
    await refresh();
    onDone();
    announce(done);
  };
  const open = (next: Action) => { setError(''); setAction(next); };
  return <section className="stack member-actions" aria-label={`${member.displayName}さんの管理`}>
    <h3 className="mb-0">メンバーの管理</h3>
    <div className="member-action-buttons">
      {canTransfer && <button data-control-id={`settings.member.transfer.${member.id}`} className="button" type="button" onClick={() => open('transfer')}>管理者を渡す</button>}
      <button data-control-id={`settings.member.status.${member.id}`} className="button" type="button" onClick={() => open(suspended ? 'resume' : 'suspend')}>{suspended ? '一時停止を解除' : '一時停止'}</button>
      <button data-control-id={`settings.member.remove.${member.id}`} className="button danger" type="button" onClick={() => open('remove')}>家族グループから外す</button>
    </div>
    {action && <Dialog title={titles[action](member.displayName)} description={descriptions[action]} onClose={() => { if (!busy) setAction(null); }} actions={<>
      <button data-control-id={`settings.member.action-cancel.${member.id}`} className="button" type="button" disabled={busy} onClick={() => setAction(null)}>{ja.actions.cancel}</button>
      <button data-control-id={`settings.member.action-confirm.${member.id}`} className={action === 'resume' ? 'button primary' : 'button danger'} type="button" disabled={busy} onClick={() => void run()}>{busy ? '処理中…' : confirmLabels[action]}</button>
    </>}>{error && <p className="field-error" role="alert">{error}</p>}</Dialog>}
  </section>;
}

/** 家族グループからの退出。管理者は先に管理者を渡す必要がある。 */
export function LeaveHousehold() {
  const { snapshot, gateway, announce, finishSignIn } = useApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (snapshot.viewer.role === 'owner') return null;
  const leave = async () => {
    if (busy) return;
    setBusy(true); setError('');
    const result = await gateway.family.leaveHousehold();
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    setOpen(false);
    announce(`「${snapshot.household.name}」から退出しました。`);
    navigate(await finishSignIn('/welcome'));
  };
  return <section className="card mt-1"><h2>家族グループから退出</h2><p className="muted">退出すると、この家族の情報は表示できなくなります。作った記録は残ります。もう一度参加するには、新しい招待コードが必要です。</p>
    <button data-control-id="settings.household.leave-open" className="button danger" type="button" onClick={() => { setError(''); setOpen(true); }}>家族グループから退出</button>
    {open && <Dialog title="家族グループから退出しますか" description={`「${snapshot.household.name}」の情報は表示できなくなります。`} onClose={() => { if (!busy) setOpen(false); }} actions={<>
      <button data-control-id="settings.household.leave-cancel" className="button" type="button" disabled={busy} onClick={() => setOpen(false)}>{ja.actions.cancel}</button>
      <button data-control-id="settings.household.leave-confirm" className="button danger" type="button" disabled={busy} onClick={() => void leave()}>{busy ? '処理中…' : '退出する'}</button>
    </>}>{error && <p className="field-error" role="alert">{error}</p>}</Dialog>}
  </section>;
}
