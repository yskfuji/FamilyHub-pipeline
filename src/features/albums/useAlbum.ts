import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { hasProcessing } from '../../domain/albumView';
import type { Album, AlbumItem, Id } from '../../domain/types';

const POLL_MS = 1500;
const MAX_POLLS = 600;

export type AlbumState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; album: Album; items: AlbumItem[] };

/** アルバムの詳細を読む。確認中のファイルがあるあいだは読み直して、表示を進める。 */
export function useAlbum(albumId: Id) {
  const { gateway } = useApp();
  const [state, setState] = useState<AlbumState>({ status: 'loading' });
  const latestRequest = useRef(0);
  /** 並べ替えを送っている間は、古い並びで上書きしない。 */
  const holds = useRef(0);

  const load = useCallback(async () => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    const result = await gateway.albums.getAlbum(albumId);
    if (request !== latestRequest.current || holds.current > 0) return;
    if (result.ok) setState({ status: 'ready', album: result.value.album, items: result.value.items });
    else if (result.error.code === 'NOT_FOUND') setState({ status: 'missing' });
    else setState({ status: 'failed', message: result.error.message });
  }, [gateway, albumId]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const processing = state.status === 'ready' && hasProcessing(state.items);
  useEffect(() => {
    if (!processing) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) window.clearInterval(timer); else void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [processing, load]);

  const change = useCallback((update: (album: Album, items: AlbumItem[]) => { album: Album; items: AlbumItem[] }) => {
    setState((current) => (current.status === 'ready' ? { status: 'ready', ...update(current.album, current.items) } : current));
  }, []);

  const hold = useCallback(() => { holds.current += 1; }, []);
  /** 持っている数を返す。0 なら読み直してよい。 */
  const release = useCallback(() => { holds.current -= 1; return holds.current; }, []);

  return { state, load, change, hold, release };
}
