import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { EmptyState, StatusBadge, formatDate, formatTime } from '../../design-system/components';
import { RESTORE_WINDOW_DAYS, RETENTION_DAYS, restoreDaysLeft } from '../../domain/restoreWindow';
import type { Result, TrashItem, TrashKind } from '../../domain/types';

const kindLabels: Record<TrashKind, string> = { event: '予定', occurrence: '繰り返しの1回', task: 'タスク', memo: 'メモ', expense: '家計', album: 'アルバム', photo: '写真や動画' };

const itemKey = (item: TrashItem) => `${item.kind}.${item.id}.${item.occurrenceDate ?? 'all'}`;

/** 削除から元に戻せる期間の記録の一覧。読み込めないときは「ない」と言わず、もう一度読めるようにする。 */
export function RecentlyDeleted() {
  const { gateway, snapshot, refresh, announce } = useApp();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await gateway.trash.list();
    if (result.ok) { setItems(result.value); setError(''); } else setError(result.error.message);
  }, [gateway]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const restoreOf = (item: TrashItem): Promise<Result<unknown>> => {
    switch (item.kind) {
      case 'event': return gateway.events.restoreEvent(item.id);
      case 'occurrence': return gateway.events.restoreEvent(item.id, item.occurrenceDate);
      case 'task': return gateway.todos.restoreTodo(item.id);
      case 'memo': return gateway.memos.restoreMemo(item.id);
      case 'expense': return gateway.expenses.restoreExpense(item.id);
      case 'album': return gateway.albums.restoreAlbum(item.id);
      case 'photo': return gateway.albums.restoreItem(item.parentId ?? '', item.id);
    }
  };
  const restore = async (item: TrashItem) => {
    if (busy) return;
    setBusy(itemKey(item));
    const result = await restoreOf(item);
    setBusy(null);
    if (!result.ok) { announce(result.error.message); return; }
    await Promise.all([load(), refresh()]);
    announce(`「${item.title}」を元に戻しました。`);
  };
  if (error && !items) return <div className="notice error" role="alert"><strong>{error}</strong><button data-control-id="settings.recently-deleted.retry" className="button mt-1" type="button" onClick={() => void load()}>{ja.actions.retry}</button></div>;
  if (!items) return <div className="skeleton" aria-busy="true"/>;
  if (!items.length) return <EmptyState title="最近削除したものはありません">削除した記録は、ここから{RESTORE_WINDOW_DAYS}日以内に元に戻せます。</EmptyState>;
  return <section className="card">
    <p className="muted">削除から{RESTORE_WINDOW_DAYS}日以内なら元に戻せます。{RETENTION_DAYS}日を過ぎると完全に消えます。自分が削除できる記録だけを表示します。</p>
    <ul className="list">{items.map((item) => {
      const key = itemKey(item);
      return <li className="list-row trash-row" key={key}>
        <StatusBadge>{kindLabels[item.kind]}</StatusBadge>
        <div className="row-main"><strong>{item.title}</strong><span className="meta">{formatDate(item.deletedAt)} {formatTime(item.deletedAt)}に削除 · あと{restoreDaysLeft(item.deletedAt, snapshot.context.asOf)}日</span></div>
        <button data-control-id={`settings.recently-deleted.restore.${key}`} className="button" type="button" disabled={busy !== null} aria-label={`「${item.title}」を元に戻す`} onClick={() => void restore(item)}>{busy === key ? '戻しています…' : ja.actions.restore}</button>
      </li>;
    })}</ul>
  </section>;
}
