import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { Dialog } from '../../design-system/components';
import { IDLE_TIMEOUT_CHOICES } from '../../domain/account';
import type { AccountProfile } from '../../domain/types';
import { LeaveHousehold } from './MemberActions';

export const avatarPresets = [['leaf', '葉'], ['sun', '陽'], ['wave', '波'], ['mountain', '山'], ['star', '星'], ['flower', '花']] as const;

/** 画像を端末の中で 192px に縮め、元の写真（位置情報を含むことがある）を送らない。 */
async function resizedAvatar(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = 192; canvas.height = 192;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas.getContext('2d')?.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 192, 192);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function AccountSection() {
  const { gateway, announce, refresh, endSession, can, runtimeMode } = useApp();
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [enrollment, setEnrollment] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const load = useCallback(async () => { const result = await gateway.auth.getAccount(); if (result.ok) setAccount(result.value); else setError(result.error.message); }, [gateway]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (!account) return <section className="card" aria-busy="true"><p>読み込んでいます。</p>{error && <p className="field-error" role="alert">{error}</p>}</section>;
  const update = async (input: Parameters<typeof gateway.auth.updateAccount>[0], message: string) => {
    setError('');
    const result = await gateway.auth.updateAccount(input);
    if (!result.ok) { setError(result.error.message); return; }
    setAccount(result.value); announce(message); await refresh();
  };
  const saveName = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void update({ displayName: String(new FormData(event.currentTarget).get('displayName')) }, '名前を変更しました。'); };
  const saveEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await gateway.auth.changeEmail(String(new FormData(event.currentTarget).get('email')));
    if (result.ok) { setAccount(result.value); announce('メールアドレスを変更しました。'); } else setError(result.error.message);
  };
  const saveBirthdate = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void update({ birthdate: String(new FormData(event.currentTarget).get('birthdate')) }, '誕生日を記録しました。'); };
  const pickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await update({ avatar: { kind: 'image', dataUrl: await resizedAvatar(file) } }, 'アイコンを変更しました。');
  };
  const beginTotp = async () => { setError(''); const result = await gateway.auth.beginTotpEnrollment(); if (result.ok) setEnrollment(result.value.otpauthUri); else setError(result.error.message); };
  const confirmTotp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await gateway.auth.confirmTotpEnrollment(String(new FormData(event.currentTarget).get('code')));
    if (!result.ok) { setError(result.error.message); return; }
    setEnrollment(null); setRecovery(result.value.recoveryCodes); await load();
  };
  const disableTotp = async () => { const result = await gateway.auth.disableTotp(); if (result.ok) { announce('確認コードの設定を解除しました。'); await load(); } else setError(result.error.message); };
  const deleteAccount = async () => {
    const result = await gateway.auth.deleteAccount();
    setDeleting(false);
    if (!result.ok) { setError(result.error.message); return; }
    await endSession();
  };
  return <div className="stack">
    {error && <p className="field-error" role="alert">{error}</p>}
    <section className="card stack"><h2>プロフィール</h2>
      <form className="stack" onSubmit={saveName}><div className="field"><label htmlFor="account-name">名前</label><input data-control-id="settings.account.name" className="input" id="account-name" name="displayName" maxLength={40} defaultValue={account.displayName} required/></div><button data-control-id="settings.account.name-save" className="button" type="submit">名前を保存</button></form>
      <fieldset className="field"><legend>アイコン</legend><div className="choice-row">
        <button data-control-id="settings.account.avatar-initial" className="button" type="button" aria-pressed={account.avatar.kind === 'initial'} onClick={() => void update({ avatar: { kind: 'initial' } }, 'アイコンを変更しました。')}>頭文字</button>
        {avatarPresets.map(([preset, glyph]) => <button data-control-id={`settings.account.avatar-preset.${preset}`} key={preset} className="button" type="button" aria-label={`${glyph}のアイコン`} aria-pressed={account.avatar.kind === 'preset' && account.avatar.preset === preset} onClick={() => void update({ avatar: { kind: 'preset', preset } }, 'アイコンを変更しました。')}>{glyph}</button>)}
        <label className="button">画像を選ぶ<input data-control-id="settings.account.avatar-image" className="sr-only" type="file" accept="image/jpeg,image/png" onChange={(event) => void pickImage(event)}/></label>
      </div></fieldset>
      {!account.birthdateDeclared && <form className="stack" onSubmit={saveBirthdate}><div className="field"><label htmlFor="account-birthdate">誕生日（一度だけ記録できます）</label><input data-control-id="settings.account.birthdate" className="input" id="account-birthdate" name="birthdate" type="date" required/></div><button data-control-id="settings.account.birthdate-save" className="button" type="submit">誕生日を記録</button></form>}
    </section>
    <section className="card stack"><h2>サインイン</h2>
      <form className="stack" onSubmit={(event) => void saveEmail(event)}><div className="field"><label htmlFor="account-email">メールアドレス</label><input data-control-id="settings.account.email" className="input" id="account-email" name="email" type="email" defaultValue={account.email} required/><span className="field-help">変更すると、前のアドレスにもお知らせを送ります。</span></div><button data-control-id="settings.account.email-save" className="button" type="submit">メールアドレスを保存</button></form>
      <div className="field"><label htmlFor="account-idle">操作がないときに自動でサインアウトする</label><select data-control-id="settings.account.idle" className="input" id="account-idle" value={account.idleTimeoutMinutes} onChange={(event) => void update({ idleTimeoutMinutes: Number(event.target.value) as 1 }, '自動サインアウトの時間を変更しました。')}>{IDLE_TIMEOUT_CHOICES.map((value) => <option key={value} value={value}>{value}分</option>)}</select></div>
      <div className="stack"><h3>確認コード</h3><p className="muted">パスワードに加えて、認証アプリの6桁のコードを求めます。</p>
        {account.totpEnabled ? <button data-control-id="settings.account.totp-disable" className="button" type="button" onClick={() => void disableTotp()}>確認コードを解除</button> : <button data-control-id="settings.account.totp-begin" className="button" type="button" onClick={() => void beginTotp()}>確認コードを設定</button>}
        {runtimeMode === 'mock' && <p className="small muted">このデモでは実際のコードは発行されません。</p>}
      </div>
    </section>
    <LeaveHousehold/>
    <section className="card stack"><h2>アカウントの削除</h2><p className="muted">削除すると、この端末からサインアウトし、元に戻せません。{can('household.members.manage') ? '管理者は、先に別の大人へ役割を渡してください。' : ''}</p><button data-control-id="settings.account.delete" className="button danger" type="button" onClick={() => setDeleting(true)}>アカウントを削除</button></section>
    {deleting && <Dialog title="アカウントを削除しますか" description="名前は「退会したメンバー」に置き換わります。この操作は取り消せません。" onClose={() => setDeleting(false)} actions={<><button data-control-id="settings.account.delete-cancel" className="button" type="button" onClick={() => setDeleting(false)}>やめる</button><button data-control-id="settings.account.delete-confirm" className="button danger" type="button" onClick={() => void deleteAccount()}>削除する</button></>}/>}
    {enrollment && <Dialog title="確認コードの設定" description="認証アプリに次の設定用の文字列を登録し、表示された6桁のコードを入力してください。" onClose={() => setEnrollment(null)}><form className="stack" onSubmit={(event) => void confirmTotp(event)}><code className="wrap-anywhere">{enrollment}</code><div className="field"><label htmlFor="totp-code">6桁のコード</label><input data-control-id="settings.account.totp-code" className="input" id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" required/></div><button data-control-id="settings.account.totp-confirm" className="button primary" type="submit">設定する</button></form></Dialog>}
    {recovery && <Dialog title="回復コード" description="端末をなくしたときに使います。安全な場所に控えてください。表示はこの1回だけです。" onClose={() => setRecovery(null)} actions={<button data-control-id="settings.account.recovery-close" className="button primary" type="button" onClick={() => setRecovery(null)}>控えました</button>}><ul className="stack">{recovery.map((code) => <li key={code}><code>{code}</code></li>)}</ul></Dialog>}
  </div>;
}
