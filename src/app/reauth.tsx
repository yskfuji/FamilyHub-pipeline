import { useCallback, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { FamilyHubGateway } from '../data/gateway';
import { Dialog } from '../design-system/components';
import type { Result } from '../domain/types';

type AskReason = 'reauth' | 'expired';

/**
 * 本人確認が必要な応答を受けたら、入力中の画面の上で確認し、同じ操作をやり直す。
 * 画面ごとに同じ処理を書かずに済み、入力中のフォームも失われない。
 */
export function withReauthentication(gateway: FamilyHubGateway, ask: (reason: AskReason) => Promise<boolean>): FamilyHubGateway {
  const wrapPort = <T extends object>(port: T, exempt: readonly string[] = []): T => new Proxy(port, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver) as unknown;
      if (typeof member !== 'function' || exempt.includes(String(key))) return member;
      return async (...args: unknown[]) => {
        const run = () => (member as (...values: unknown[]) => Promise<Result<unknown>>).apply(target, args);
        const result = await run();
        if (result.ok) return result;
        const reason: AskReason | null = result.error.code === 'REAUTH_REQUIRED' ? 'reauth' : result.error.reason === 'SESSION_EXPIRED' ? 'expired' : null;
        if (!reason || !(await ask(reason))) return result;
        return run();
      };
    },
  });
  return {
    auth: wrapPort(gateway.auth, ['getSession', 'signInWithPassword', 'reauthenticate', 'signOut', 'beginPasskey', 'finishPasskey', 'verifyTotp', 'signUp', 'requestPasswordReset', 'confirmPasswordReset']),
    household: wrapPort(gateway.household), events: wrapPort(gateway.events), todos: wrapPort(gateway.todos), memos: wrapPort(gateway.memos),
    expenses: wrapPort(gateway.expenses), albums: wrapPort(gateway.albums, ['mediaUrl']), family: wrapPort(gateway.family), links: wrapPort(gateway.links), trash: wrapPort(gateway.trash), resources: wrapPort(gateway.resources), insights: wrapPort(gateway.insights), notifications: wrapPort(gateway.notifications),
    credentials: gateway.credentials,
  };
}

interface Pending { reason: AskReason; resolve: (confirmed: boolean) => void }

export function useReauthPrompt() {
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const ask = useCallback((reason: AskReason) => {
    // 同時に複数の操作が確認を求めても、確認は1回にまとめる。
    inFlight.current ??= new Promise<boolean>((resolve) => setPending({ reason, resolve })).finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, []);
  return { pending, setPending, ask };
}

export function ReauthDialog({ pending, onSubmit, onCancel }: { pending: Pending; onSubmit: (password: string) => Promise<string | null>; onCancel: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError('');
    const failure = await onSubmit(String(new FormData(event.currentTarget).get('password')));
    setBusy(false);
    if (failure) setError(failure);
  };
  const expired = pending.reason === 'expired';
  return <Dialog title={expired ? 'もう一度サインインしてください' : '本人確認'} description={expired ? '時間がたったため、サインインし直す必要があります。入力中の内容はそのまま残ります。' : 'この操作を続けるには、パスワードを入力してください。'} onClose={onCancel}>
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <div className="field"><label htmlFor="reauth-password">パスワード</label><input data-control-id="reauth.password" className="input" id="reauth-password" name="password" type="password" autoComplete="current-password" required autoFocus/></div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button data-control-id="reauth.cancel" className="button" type="button" onClick={onCancel}>やめる</button><button data-control-id="reauth.submit" className="button primary" type="submit" disabled={busy}>{busy ? '確認中…' : '続ける'}</button></div>
    </form>
  </Dialog>;
}
