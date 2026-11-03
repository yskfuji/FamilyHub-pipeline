import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { Brand, StatusBadge } from '../../design-system/components';
import { LockIcon, ShieldIcon } from '../../design-system/icons';
import { currentPasswordSchema } from '../../domain/schemas';

export function AuthPage() {
  const { gateway, finishSignIn, runtimeMode } = useApp();
  const [totpChallenge, setTotpChallenge] = useState<string | null>(null);
  const [passwordMode, setPasswordMode] = useState(false);
  const [error, setError] = useState('');
  // 開始 → 端末で本人確認（署名）→ API 側で検証して完了、の3段階。完了したときだけ先へ進む。
  const passkey = async () => {
    setError('');
    const begun = await gateway.auth.beginPasskey();
    if (!begun.ok) { setError(begun.error.message); return; }
    const assertion = await gateway.credentials.get(begun.value.publicKey);
    if (!assertion.ok) { setError(assertion.error.message); return; }
    const finished = await gateway.auth.finishPasskey(begun.value.challengeId, assertion.value);
    if (!finished.ok) { setError(finished.error.message); return; }
    navigate(await finishSignIn('/onboarding'));
  };
  const verifyTotp = async (form: HTMLFormElement) => {
    if (!totpChallenge) return;
    setError('');
    const result = await gateway.auth.verifyTotp(totpChallenge, String(new FormData(form).get('code')));
    if (result.ok) navigate(await finishSignIn('/today')); else setError(result.error.message);
  };
  const password = async (form: HTMLFormElement) => {
    setError(''); const data = new FormData(form); const value = String(data.get('password'));
    const parsed = currentPasswordSchema.safeParse(value); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '入力を確認してください'); return; }
    const result = await gateway.auth.signInWithPassword(String(data.get('email')), value); if (!result.ok) { setError(result.error.message); return; }
    if ('totpChallengeId' in result.value) { setTotpChallenge(result.value.totpChallengeId); return; }
    navigate(await finishSignIn('/today'));
  };
  return <main className="auth-layout"><aside className="auth-aside"><Brand/><div><p className="eyebrow" style={{ color: '#ed9e7b' }}>共有する相手を確認できます。</p><h1>家族の情報を、<br/>必要な人だけに。</h1><p>共有する相手と、サインイン中の端末を確認できます。使わなくなった端末は、いつでもサインアウトできます。</p></div><p className="small">このアプリは、パスワードやパスキーの情報をブラウザ内に保存しません。</p></aside><section className="auth-main"><div className="auth-card"><StatusBadge tone="success"><ShieldIcon width="14"/>おすすめ</StatusBadge><h1 style={{ marginTop: '1rem' }}>おかえりなさい</h1><p className="muted">パスキーなら、端末の画面ロックを使ってサインインできます。パスワードでも続けられます。</p>{totpChallenge ? <form className="stack" onSubmit={(event) => { event.preventDefault(); void verifyTotp(event.currentTarget); }}><div className="field"><label htmlFor="totp">確認コード</label><input data-control-id="auth.totp" className="input" id="totp" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} required/><span className="field-help">認証アプリの6桁のコード、または回復コードを入力してください。</span></div><button data-control-id="auth.totp-submit" className="button primary full" type="submit">続ける</button></form> : !passwordMode ? <div className="stack"><button data-control-id="auth.passkey" className="button primary full" type="button" onClick={() => void passkey()}><LockIcon width="19"/>パスキーでサインイン</button><div className="divider">または</div><button data-control-id="auth.password-mode.open" className="button full" type="button" onClick={() => setPasswordMode(true)}>パスワードでサインイン</button><a data-control-id="auth.sign-up" className="button full" href="/sign-up" data-link>はじめての方</a><a data-control-id="auth.reset" className="link-button" href="/reset-password" data-link>パスワードを忘れた場合</a></div> : <form className="stack" onSubmit={(event) => { event.preventDefault(); void password(event.currentTarget); }}><div className="field"><label htmlFor="email">メールアドレス</label><input data-control-id="auth.email" className="input" id="email" name="email" type="email" autoComplete="username" defaultValue={runtimeMode === 'mock' ? 'aoi@example.test' : undefined} required/></div><div className="field"><label htmlFor="password">パスワード</label><input data-control-id="auth.password" className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={15} maxLength={64} required/><span className="field-help">15〜64文字で入力してください。文字種の指定はありません。</span></div><button data-control-id="auth.sign-in" className="button primary full" type="submit">サインイン</button><button data-control-id="auth.password-mode.cancel" className="button full" type="button" onClick={() => setPasswordMode(false)}>パスキーでのサインインに戻る</button></form>}{error && <p className="notice error mt-1" role="alert">{error}</p>}<p className="small muted mt-1">このデモでは、実際のアカウントには接続しません。</p></div></section></main>;
}
