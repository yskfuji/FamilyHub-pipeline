import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { Brand } from '../../design-system/components';

export function ResetPasswordPage() {
  const { gateway } = useApp();
  // リンクの token は URL の # より後に置き、API へのアクセス記録やリファラーに残らないようにする。
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>(token ? 'confirm' : 'request');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => { if (token) window.history.replaceState({}, '', '/reset-password'); }, [token]);
  useEffect(() => { if (wait <= 0) return; const id = window.setTimeout(() => setWait(wait - 1), 1000); return () => window.clearTimeout(id); }, [wait]);
  const request = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setError('');
    const result = await gateway.auth.requestPasswordReset(email);
    if (!result.ok) { setError(result.error.message); return; }
    setWait(result.value.resendAfterSeconds); setStep('confirm');
  };
  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError('');
    const result = await gateway.auth.confirmPasswordReset({ ...(token ? { token } : { email, code: String(data.get('code')) }), newPassword: String(data.get('password')) });
    if (result.ok) setStep('done'); else setError(result.error.message);
  };
  return <main className="auth-layout auth-layout-single"><section className="auth-main"><div className="auth-card"><Brand/><h1>パスワードの再設定</h1>
    {step === 'request' && <form className="stack" onSubmit={(event) => void request(event)}><p className="muted">登録したメールアドレスにコードを送ります。</p><div className="field"><label htmlFor="reset-email">メールアドレス</label><input data-control-id="reset.email" className="input" id="reset-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)}/></div>{error && <p className="field-error" role="alert">{error}</p>}<button data-control-id="reset.request" className="button primary full" type="submit">コードを送る</button></form>}
    {step === 'confirm' && <form className="stack" onSubmit={(event) => void confirm(event)}>{!token && <><p className="muted">メールが届くまで少しかかることがあります。登録のないアドレスには届きません。</p><div className="field"><label htmlFor="reset-code">6桁のコード</label><input data-control-id="reset.code" className="input" id="reset-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required/></div></>}<div className="field"><label htmlFor="reset-password">新しいパスワード</label><input data-control-id="reset.password" className="input" id="reset-password" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={64} required/></div>{error && <p className="field-error" role="alert">{error}</p>}<button data-control-id="reset.confirm" className="button primary full" type="submit">再設定する</button>{!token && <button data-control-id="reset.resend" className="button full" type="button" disabled={wait > 0} onClick={() => void request()}>{wait > 0 ? `あと${wait}秒で再送できます` : 'コードを再送する'}</button>}</form>}
    {step === 'done' && <div className="stack"><p role="status">再設定しました。新しいパスワードでサインインしてください。</p></div>}
    <a data-control-id="reset.back" className="button full" href="/auth" data-link>サインインに戻る</a>
  </div></section></main>;
}
