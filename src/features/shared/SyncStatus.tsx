import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { formatDue, formatTime } from '../../design-system/components';

/** 最後に更新した時刻と、今すぐ読み直す操作。読み直せなかったときは、もう一度試せるようにする。 */
export function SyncStatus() {
  const { snapshot, refresh, announce } = useApp();
  const [state, setState] = useState<'idle' | 'running' | 'failed'>('idle');
  const { sync, asOf } = snapshot.context;
  const updated = formatDue(sync.lastSyncedAt, asOf);
  const run = async () => {
    setState('running');
    const done = await refresh();
    setState(done ? 'idle' : 'failed');
    if (done) announce('最新の内容に更新しました。');
  };
  const running = state === 'running' || sync.state === 'syncing';
  return <div className="sync-status">
    {running
      ? <span className="badge attention">更新しています</span>
      : sync.state === 'offline'
        ? <span className="badge attention">オフライン（最終更新 {formatTime(sync.lastSyncedAt)}）</span>
        : <span className="badge success"><span className="status-dot"/>最終更新 {updated}</span>}
    <button data-control-id="sync.now" className="button" type="button" disabled={running} onClick={() => void run()}>{state === 'failed' ? 'もう一度更新' : '今すぐ更新'}</button>
    {state === 'failed' && <p className="field-error mb-0" role="alert">更新できませんでした。接続を確認して、もう一度お試しください。</p>}
  </div>;
}
