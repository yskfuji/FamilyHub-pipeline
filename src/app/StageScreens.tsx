import { useEffect, useState } from 'react';
import { Brand, EmptyState } from '../design-system/components';
import { EmptyOffline } from '../design-system/illustrations/EmptyOffline';
import { useApp } from './AppContext';
import { navigate } from './router';
import type { AppStage } from './AppContext';

const SLOW_RESTORE_MS = 15_000;

function Restoring() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const id = window.setTimeout(() => setSlow(true), SLOW_RESTORE_MS); return () => window.clearTimeout(id); }, []);
  const { refresh } = useApp();
  return <main className="stage-screen" aria-busy="true"><Brand/>
    <p role="status">{slow ? '読み込みに時間がかかっています。接続を確認してください。' : '読み込んでいます。'}</p>
    {slow && <button data-control-id="stage.restoring.retry" className="button primary" onClick={() => void refresh()}>もう一度読み込む</button>}
  </main>;
}

/** 本編に入る前の状態ごとの画面。 */
export function StageScreen({ stage }: { stage: Exclude<AppStage, 'ready'> }) {
  const { refresh, endSession } = useApp();
  useEffect(() => {
    if (stage === 'signed-out') navigate('/auth', true);
    if (stage === 'household-setup') navigate('/onboarding', true);
  }, [stage]);
  if (stage === 'restoring' || stage === 'signed-out' || stage === 'household-setup') return <Restoring/>;
  if (stage === 'unreachable') return <main className="stage-screen"><Brand/><EmptyState title="接続できません" illustration={<EmptyOffline/>} action={<button data-control-id="stage.unreachable.retry" className="button primary" onClick={() => void refresh()}>もう一度試す</button>}>インターネットの接続を確認してください。</EmptyState></main>;
  if (stage === 'suspended') return <main className="stage-screen"><Brand/><EmptyState title="参加が一時停止されています" action={<button data-control-id="stage.suspended.sign-out" className="button secondary" onClick={() => void endSession()}>サインアウト</button>}>家族グループの管理者に確認してください。</EmptyState></main>;
  return <main className="stage-screen"><Brand/><EmptyState title="利用期間が終わりました" action={<button data-control-id="stage.paywall.sign-out" className="button secondary" onClick={() => void endSession()}>サインアウト</button>}>記録は残っています。続けて使うには、運営者へ利用の延長を依頼してください。</EmptyState></main>;
}
