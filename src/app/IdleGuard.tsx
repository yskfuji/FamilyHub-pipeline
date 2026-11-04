import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext';

const CHANNEL = 'family-hub-activity';
const PING_MS = 60_000;
const WARNING_MS = 60_000;

/**
 * 操作がないときに残り時間を知らせる。サインアウトの判定そのものは API が行い、ここは案内にとどめる。
 * 同じブラウザの別のタブの操作も操作として数える。
 */
export function IdleGuard() {
  const { session, gateway, appStage, endSession } = useApp();
  const limitMs = (session?.idleTimeoutMinutes ?? 30) * 60_000;
  const lastActivity = useRef(0);
  const lastPing = useRef(0);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (appStage !== 'ready') return;
    lastActivity.current = Date.now();
    lastPing.current = Date.now();
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
    const record = (share: boolean) => {
      lastActivity.current = Date.now();
      setRemaining(null);
      if (share) channel?.postMessage('active');
      // API 側の時間切れも延ばすため、操作が続く間は間隔をあけて知らせる。
      if (Date.now() - lastPing.current > PING_MS) { lastPing.current = Date.now(); void gateway.auth.getSession(); }
    };
    const onActivity = () => record(true);
    if (channel) channel.onmessage = () => record(false);
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    const timer = window.setInterval(() => {
      const left = limitMs - (Date.now() - lastActivity.current);
      if (left <= 0) { window.clearInterval(timer); void endSession(); return; }
      setRemaining(left <= WARNING_MS ? Math.ceil(left / 1000) : null);
    }, 1000);
    return () => { window.clearInterval(timer); window.removeEventListener('pointerdown', onActivity); window.removeEventListener('keydown', onActivity); channel?.close(); };
  }, [appStage, endSession, gateway, limitMs]);

  if (remaining === null) return null;
  return <div className="idle-card" role="alert"><p>操作がないため、あと{remaining}秒でサインアウトします。</p><button data-control-id="idle.continue" className="button primary" type="button">続ける</button></div>;
}
