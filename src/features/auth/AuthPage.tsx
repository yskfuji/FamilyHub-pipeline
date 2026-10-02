import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { Brand, StatusBadge } from '../../design-system/components';
import { LockIcon, ShieldIcon } from '../../design-system/icons';
import { passwordSchema } from '../../domain/schemas';

export function AuthPage() {
  const { gateway } = useApp();
  const [passwordMode, setPasswordMode] = useState(false);
  const [error, setError] = useState('');
  const passkey = async () => { const result = await gateway.auth.beginPasskey(); if (result.ok) navigate('/onboarding'); else setError(result.error.message); };
  const password = async (form: HTMLFormElement) => {
    setError(''); const data = new FormData(form); const value = String(data.get('password'));
    const parsed = passwordSchema.safeParse(value); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '入力を確認してください'); return; }
    const result = await gateway.auth.signInWithPassword(String(data.get('email')), value); if (result.ok) navigate('/today'); else setError(result.error.message);
  };
  return <main className="auth-layout"><aside className="auth-aside"><Brand/><div><p className="eyebrow" style={{ color: '#ed9e7b' }}>共有する相手を確認できます。</p><h1>家族の情報を、<br/>必要な人だけに。</h1><p>共有する相手と、サインイン中の端末を確認できます。使わなくなった端末は、いつでもサインアウトできます。</p></div><p className="small">このアプリは、パスワードやパスキーの情報をブラウザ内に保存しません。</p></aside><section className="auth-main"><div className="auth-card"><StatusBadge tone="success"><ShieldIcon width="14"/>おすすめ</StatusBadge><h1 style={{ marginTop: '1rem' }}>おかえりなさい</h1><p className="muted">パスキーなら、端末の画面ロックを使ってサインインできます。パスワードでも続けられます。</p>{!passwordMode ? <div className="stack"><button data-control-id="auth.passkey" className="button primary full" type="button" onClick={() => void passkey()}><LockIcon width="19"/>パスキーでサインイン</button><div className="divider">または</div><button data-control-id="auth.password-mode.open" className="button full" type="button" onClick={() => setPasswordMode(true)}>パスワードでサインイン</button></div> : <form className="stack" onSubmit={(event) => { event.preventDefault(); void password(event.currentTarget); }}><div className="field"><label htmlFor="email">メールアドレス</label><input data-control-id="auth.email" className="input" id="email" name="email" type="email" autoComplete="username" defaultValue="aoi@example.test" required/></div><div className="field"><label htmlFor="password">パスワード</label><input data-control-id="auth.password" className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={15} maxLength={64} required/><span className="field-help">15〜64文字で入力してください。文字種の指定はありません。</span></div><button data-control-id="auth.sign-in" className="button primary full" type="submit">サインイン</button><button data-control-id="auth.password-mode.cancel" className="button full" type="button" onClick={() => setPasswordMode(false)}>パスキーでのサインインに戻る</button></form>}{error && <p className="notice error mt-1" role="alert">{error}</p>}<p className="small muted mt-1">このデモでは、実際のアカウントには接続しません。</p></div></section></main>;
}
