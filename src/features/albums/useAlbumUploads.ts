import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../app/AppContext';
import { createUploadQueue } from './uploadQueue';
import { makeVideoThumbnail } from './videoThumbnail';

export type AlbumUploads = ReturnType<typeof useAlbumUploads>;

/** アルバムの画面全体で1つ持つ待ち行列。一覧と詳細を行き来しても送信は続く。 */
export function useAlbumUploads() {
  const { gateway } = useApp();
  /** ファイルの処理が終わった回数。増えたらアルバムを読み直す。 */
  const [settled, setSettled] = useState(0);
  const [queue] = useState(() => createUploadQueue({ gateway: gateway.albums, makeThumbnail: makeVideoThumbnail, onSettled: () => setSettled((value) => value + 1) }));
  const entries = useSyncExternalStore(queue.subscribe, queue.getEntries);
  const sending = entries.some((entry) => entry.state === 'sending' || entry.state === 'waiting');
  useEffect(() => () => queue.dispose(), [queue]);
  // 送っている途中でタブを閉じると、送り直しができなくなる。
  useEffect(() => {
    if (!sending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sending]);
  return { queue, entries, settled };
}
