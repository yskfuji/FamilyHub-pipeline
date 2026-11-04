import { useCallback, useEffect, useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { navigate } from '../../app/router';
import { ja } from '../../content/ja';
import { Dialog, EmptyState, PageHeader } from '../../design-system/components';
import { EmptyAlbums } from '../../design-system/illustrations/EmptyAlbums';
import { ImageIcon, LockIcon, PlusIcon } from '../../design-system/icons';
import { albumDraftToCreateInput, newAlbumDraft, type AlbumAudience, type AlbumDraft } from '../../domain/albumForm';
import { coverItem } from '../../domain/albumView';
import { defaultAudience } from '../../domain/visibilityForm';
import type { Album, AlbumItem, AlbumSummary } from '../../domain/types';
import { audienceText } from '../shared/visibilityText';
import { AlbumForm } from './AlbumForm';
import type { AlbumUploads } from './useAlbumUploads';

/** 表紙。指定がないときや表紙の項目が消えたときは、アルバムの最初の項目を読みに行く。 */
function AlbumCover({ album }: { album: AlbumSummary }) {
  const { gateway } = useApp();
  const [coverFailed, setCoverFailed] = useState(false);
  const [fallback, setFallback] = useState<AlbumItem | null>(null);
  const needsLookup = album.itemCount > 0 && (!album.coverItemId || coverFailed);
  useEffect(() => {
    if (!needsLookup) return;
    let active = true;
    void gateway.albums.getAlbum(album.id).then((result) => { if (active && result.ok) setFallback(coverItem({}, result.value.items) ?? null); });
    return () => { active = false; };
  }, [gateway, album.id, needsLookup]);
  const chosen = album.coverItemId && !coverFailed ? { id: album.coverItemId, albumId: album.id } : fallback;
  if (!chosen) return <span className="album-placeholder"><ImageIcon/></span>;
  return <img className="album-image" src={gateway.albums.mediaUrl(chosen, 'thumbnail')} alt="" loading="lazy" decoding="async" onError={() => { if (chosen === fallback) setFallback(null); else setCoverFailed(true); }}/>;
}

interface Props {
  uploads: AlbumUploads;
  deleted: Album | null;
  onRestored: () => void;
}

export function AlbumList({ uploads, deleted, onRestored }: Props) {
  const { snapshot, gateway, announce, can, privacy } = useApp();
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canCreate = can('album.create');

  const load = useCallback(async () => {
    const result = await gateway.albums.listAlbums();
    if (result.ok) { setAlbums(result.value); setLoadError(''); } else setLoadError(result.error.message);
  }, [gateway]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const create = async (draft: AlbumDraft) => {
    if (submitting) return;
    setFormError(''); setSubmitting(true);
    const result = await gateway.albums.createAlbum(albumDraftToCreateInput(draft));
    setSubmitting(false);
    if (!result.ok) { setFormError(result.error.message); return; }
    setCreating(false);
    announce('アルバムを作成しました');
    navigate(`/albums/${result.value.id}`);
  };
  const restore = async () => {
    if (!deleted) return;
    const result = await gateway.albums.restoreAlbum(deleted.id);
    if (!result.ok) { announce(result.error.message); return; }
    onRestored();
    await load();
    announce(`「${result.value.title}」を元に戻しました`);
  };
  const active = uploads.entries.filter((entry) => ['waiting', 'sending', 'processing'].includes(entry.state)).length;

  return <div className="page">
    <PageHeader eyebrow="アルバム" title="家族のアルバム" description="写真や動画をアルバムにまとめて、見せる相手を選んで残します。" action={canCreate ? <button data-control-id="albums.create.open" className="button primary" type="button" onClick={() => { setFormError(''); setCreating(true); }}><PlusIcon width="18"/>アルバムを作る</button> : undefined}/>
    {active > 0 && <div className="callout info" role="status"><ImageIcon/><div><strong>{active}件を送っています</strong><p className="small muted mb-0">アルバムの画面を離れると、送信は止まります。</p></div></div>}
    {deleted && <div className="callout info" role="status"><ImageIcon/><div><strong>「{deleted.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id="albums.restore" className="button" type="button" onClick={() => void restore()}>{ja.actions.restore}</button></div>}
    {loadError && <div className="notice error" role="alert">{loadError}<button data-control-id="albums.list.retry" className="button mt-1" type="button" onClick={() => void load()}>もう一度読み込む</button></div>}
    {albums === null
      ? !loadError && <div className="album-list" aria-busy="true" aria-label="アルバムを読み込んでいます"><div className="skeleton"/><div className="skeleton"/></div>
      : albums.length === 0
        ? <EmptyState title="見られるアルバムはまだありません" illustration={<EmptyAlbums/>} action={canCreate ? <button data-control-id="albums.create.empty" className="button primary" type="button" onClick={() => setCreating(true)}>アルバムを作る</button> : undefined}>{canCreate ? '運動会や旅行など、まとめたい写真ごとに作れます。' : '共有されると、ここに表示されます。'}</EmptyState>
        : <ul className="album-list">{albums.map((album) => <li key={album.id}><a data-control-id={`albums.open.${album.id}`} className="card album-card" href={`/albums/${album.id}`} data-link>
          <span className="album-cover"><AlbumCover album={album}/></span>
          <span className="album-card-body">
            <strong className="album-card-title">{album.title}</strong>
            <span className="meta">{album.itemCount}件</span>
            <span className="meta album-card-audience"><LockIcon width="12" aria-hidden="true"/> {audienceText('album', album.visibility, (id) => memberName(snapshot, id))}</span>
          </span>
        </a></li>)}</ul>}
    {creating && <Dialog title="アルバムを作る" description="写真や動画は、作ったあとに追加します。" onClose={() => { if (!submitting) setCreating(false); }}>
      <AlbumForm formId="new" initial={newAlbumDraft(defaultAudience(snapshot.viewer.role, 'album', privacy?.defaultAudience) as AlbumAudience)} submitLabel="作成する" busyLabel="作成中…" busy={submitting} error={formError} onSubmit={(draft) => void create(draft)} onCancel={() => setCreating(false)}/>
    </Dialog>}
  </div>;
}
