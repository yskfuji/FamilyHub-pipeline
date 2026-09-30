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
  return <main className="auth-layout"><aside className="auth-aside"><Brand/><div><p className="eyebrow" style={{ color: '#ed9e7b' }}>共有する範囲を、はっきりと。</p><h1>家族の情報を、<br/>家族の範囲に。</h1><p>共有相手とログイン中の端末を確認でき、不要になった端末はあとから終了できます。</p></div><p className="small">パスワードや認証用の秘密情報を、ブラウザの通常の保存領域へ残しません。</p></aside><section className="auth-main"><div className="auth-card"><StatusBadge tone="success"><ShieldIcon width="14"/>推奨</StatusBadge><h1 style={{ marginTop: '1rem' }}>おかえりなさい</h1><p className="muted">まずパスキーを使います。パスワードは別の方法として利用できます。</p>{!passwordMode ? <div className="stack"><button className="button primary full" type="button" onClick={() => void passkey()}><LockIcon width="19"/>パスキーで続ける</button><div className="divider">または</div><button className="button full" type="button" onClick={() => setPasswordMode(true)}>パスワードを使う</button></div> : <form className="stack" onSubmit={(event) => { event.preventDefault(); void password(event.currentTarget); }}><div className="field"><label htmlFor="email">メールアドレス</label><input className="input" id="email" name="email" type="email" autoComplete="username" defaultValue="aoi@example.test" required/></div><div className="field"><label htmlFor="password">パスワード</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={15} maxLength={64} required/><span className="field-help">15〜64文字。文字種の組み合わせは強制しません。</span></div><button className="button primary full" type="submit">サインイン</button><button className="button full" type="button" onClick={() => setPasswordMode(false)}>パスキーへ戻る</button></form>}{error && <p className="notice error mt-1" role="alert">{error}</p>}<p className="small muted mt-1">デモでは実際のアカウントへ接続せず、画面遷移だけを再現します。</p></div></section></main>;
}
