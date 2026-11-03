import { useState } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { Brand } from '../../design-system/components';
import { ADULT_AGE, ageOn, signUpSchema } from '../../domain/account';
import { checkNewPassword } from '../../domain/passwordPolicy';

export function SignUpPage() {
  const { gateway, finishSignIn } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [birthdate, setBirthdate] = useState('');
  const minor = birthdate !== '' && ageOn(birthdate, new Date().toISOString().slice(0, 10)) < ADULT_AGE;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { displayName: String(data.get('displayName')), email: String(data.get('email')), password: String(data.get('password')), birthdate: String(data.get('birthdate')), guardianConsent: data.get('guardianConsent') === 'on' };
    const parsed = signUpSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '入力を確認してください。'); return; }
    setBusy(true); setError('');
    const problem = await checkNewPassword(parsed.data.password, { email: parsed.data.email, displayName: parsed.data.displayName });
    if (problem) { setError(problem); setBusy(false); return; }
    const created = await gateway.auth.signUp(parsed.data);
    if (!created.ok) { setError(created.error.message); setBusy(false); return; }
    const signedIn = await gateway.auth.signInWithPassword(input.email, input.password);
    setBusy(false);
    if (!signedIn.ok) { navigate('/auth'); return; }
    navigate(await finishSignIn('/onboarding'));
  };
  return <main className="auth-layout auth-layout-single"><section className="auth-main"><div className="auth-card"><Brand/><h1>はじめての方</h1><p className="muted">アカウントを作ると、家族グループを作るか、招待コードで参加できます。</p>
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <div className="field"><label htmlFor="signup-name">名前</label><input data-control-id="sign-up.name" className="input" id="signup-name" name="displayName" autoComplete="name" maxLength={40} required/></div>
      <div className="field"><label htmlFor="signup-email">メールアドレス</label><input data-control-id="sign-up.email" className="input" id="signup-email" name="email" type="email" autoComplete="username" required/></div>
      <div className="field"><label htmlFor="signup-password">パスワード</label><input data-control-id="sign-up.password" className="input" id="signup-password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/><span className="field-help">15〜64文字で入力してください。文字種の指定はありません。</span></div>
      <div className="field"><label htmlFor="signup-birthdate">誕生日</label><input data-control-id="sign-up.birthdate" className="input" id="signup-birthdate" name="birthdate" type="date" required value={birthdate} onChange={(event) => setBirthdate(event.target.value)}/><span className="field-help">家族グループを作るには18歳以上である必要があります。</span></div>
      {minor && <label className="check-row"><input data-control-id="sign-up.guardian-consent" name="guardianConsent" type="checkbox"/>保護者の同意を得ています</label>}
      <p className="small muted mb-0">アカウントを作る前に、<a data-control-id="sign-up.legal" href="/settings/legal" target="_blank" rel="noopener">利用規約とプライバシーポリシーの草案（新しいタブ）</a>を確認してください。</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button data-control-id="sign-up.submit" className="button primary full" type="submit" disabled={busy}>{busy ? '作成中…' : 'アカウントを作る'}</button>
      <a data-control-id="sign-up.back" className="button full" href="/auth" data-link>サインインに戻る</a>
    </form>
  </div></section></main>;
}
