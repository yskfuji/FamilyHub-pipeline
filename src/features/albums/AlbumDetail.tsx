import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { navigate, useSearch, withQueryParam } from '../../app/router';
import { audienceLabel, captureTimeCopy, ja } from '../../content/ja';
import { DetailNotFound, Dialog, EmptyState, PageHeader, StatusBadge } from '../../design-system/components';
import { EmptyAlbums } from '../../design-system/illustrations/EmptyAlbums';
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ImageIcon, LockIcon, MapPinIcon, PlayIcon, SettingsIcon, TrashIcon, UploadIcon, VideoIcon } from '../../design-system/icons';
import { authorize, canDeleteResource, canMutateOwnedResource } from '../../authz/policy';
import { albumDraftToUpdateInput, albumToDraft, type AlbumDraft } from '../../domain/albumForm';
import { albumFilters, albumSorts, filterCounts, gridItems, moveItem, parseAlbumFilter, parseAlbumSort, readyItems, rejectedItems, sortItems, type AlbumFilter } from '../../domain/albumView';
import type { Album, AlbumItem, Id } from '../../domain/types';
import { audienceText } from '../shared/visibilityText';
import { AlbumForm } from './AlbumForm';
import { AlbumUpload } from './AlbumUpload';
import { ItemImage } from './ItemImage';
import { MediaViewer } from './MediaViewer';
import { Slideshow } from './Slideshow';
import { itemKindLabel } from './albumLabels';
import { saveFile } from './saveFile';
import { useAlbum } from './useAlbum';
import type { AlbumUploads } from './useAlbumUploads';

const filterLabels: Record<AlbumFilter, string> = { all: 'すべて', photos: '写真', videos: '動画' };
/** 続けて保存するときの間隔。続けざまに始めると、ブラウザに止められることがある。 */
const SAVE_INTERVAL_MS = 900;

interface Props {
  albumId: Id;
  uploads: AlbumUploads;
  onDeleted: (album: Album) => void;
}

export function AlbumDetail({ albumId, uploads, onDeleted }: Props) {
  const { state, load, change, hold, release } = useAlbum(albumId);
  useEffect(() => { if (uploads.settled) void load(); }, [uploads.settled, load]);
  if (state.status === 'loading') return <div className="page" aria-busy="true"><PageHeader eyebrow="アルバム" title="読み込んでいます" description="写真と動画を読み込んでいます。"/><div className="album-grid"><div className="skeleton"/><div className="skeleton"/></div></div>;
  if (state.status === 'missing') return <div className="page"><DetailNotFound what="アルバム" feature="albums" backHref="/albums"/></div>;
  if (state.status === 'failed') return <div className="page"><div className="notice error" role="alert">{state.message}<button data-control-id="albums.detail.retry" className="button mt-1" type="button" onClick={() => void load()}>もう一度読み込む</button></div></div>;
  return <AlbumContent album={state.album} items={state.items} uploads={uploads} load={load} change={change} hold={hold} release={release} onDeleted={onDeleted}/>;
}

interface ContentProps {
  album: Album;
  items: AlbumItem[];
  uploads: AlbumUploads;
  load: () => Promise<void>;
  change: ReturnType<typeof useAlbum>['change'];
  hold: () => void;
  release: () => number;
  onDeleted: (album: Album) => void;
}

function AlbumContent({ album, items, uploads, load, change, hold, release, onDeleted }: ContentProps) {
  const { snapshot, gateway, announce } = useApp();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const filter = parseAlbumFilter(params.get('filter'));
  const sort = parseAlbumSort(params.get('sort'));
  const requestedItem = params.get('item');
  const [panel, setPanel] = useState<'upload' | 'edit' | 'delete' | null>(null);
  const [organizing, setOrganizing] = useState(false);
  // 全体の検索から写真や動画を選ぶと ?item=<id> で来る。準備ができた項目なら表示画面を開いておく。
  const openable = (id: string | null) => Boolean(id && readyItems(gridItems(items, filter)).some((item) => item.id === id));
  const [viewing, setViewing] = useState<Id | null>(() => (openable(requestedItem) ? requestedItem : null));
  // 同じアルバムを開いたまま検索から別の項目を選んだときも、その項目を開く（描画の中で前の値と比べて合わせる）。
  const [followedItem, setFollowedItem] = useState(requestedItem);
  if (followedItem !== requestedItem) {
    setFollowedItem(requestedItem);
    if (openable(requestedItem)) setViewing(requestedItem);
  }
  const [showing, setShowing] = useState(false);
  const [deletedItem, setDeletedItem] = useState<AlbumItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const stopSaving = useRef(false);
  const version = useRef(album.version);
  const moves = useRef<Promise<void>>(Promise.resolve());
  const refocus = useRef<{ id: Id; direction: 'earlier' | 'later' } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const viewer = snapshot.viewer;
  const canEdit = canMutateOwnedResource(viewer, 'album.update', album.creatorMembershipId).allowed;
  const canUpload = canEdit || authorize(viewer, 'album.create').allowed;
  const canDeleteAlbum = canDeleteResource(viewer, 'album.delete', [album.creatorMembershipId]).allowed;
  const canDeleteItem = (item: AlbumItem) => canDeleteResource(viewer, 'album.delete', [album.creatorMembershipId, item.uploaderMembershipId]).allowed;

  // 並べ替え・整理の間は、アルバムに並べた順で動かす（撮影日順のまま動かすと、隣が分からなくなる）。
  const shown = useMemo(() => sortItems(gridItems(items, filter), organizing ? 'album' : sort), [items, filter, sort, organizing]);
  const counts = useMemo(() => filterCounts(items), [items]);
  const ready = useMemo(() => readyItems(items), [items]);
  const viewable = useMemo(() => readyItems(shown), [shown]);
  const rejected = useMemo(() => rejectedItems(items), [items]);
  const organizable = canEdit || ready.some(canDeleteItem);
  const activeUploads = uploads.entries.filter((entry) => entry.albumId === album.id && ['waiting', 'sending', 'processing'].includes(entry.state)).length;

  useEffect(() => { version.current = album.version; }, [album.version]);
  // 並べ替えると部品が移動してフォーカスが外れるので、押したボタンへ戻す（端まで来たら反対のボタンへ）。
  useLayoutEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const button = (direction: string) => document.querySelector<HTMLButtonElement>(`[data-control-id="albums.item.move-${direction}.${target.id}"]`);
    const same = button(target.direction);
    (same && !same.disabled ? same : button(target.direction === 'earlier' ? 'later' : 'earlier'))?.focus();
  }, [items]);

  const move = (id: Id, step: -1 | 1) => {
    const order = moveItem(items.map((item) => item.id), shown.map((item) => item.id), id, step);
    refocus.current = { id, direction: step < 0 ? 'earlier' : 'later' };
    change((current, currentItems) => ({ album: current, items: order.map((itemId) => currentItems.find((item) => item.id === itemId)).filter((item): item is AlbumItem => Boolean(item)) }));
    hold();
    // 続けて押しても順に送る。前の結果の版を次で使う。
    moves.current = moves.current.then(async () => {
      const result = await gateway.albums.reorderItems(album.id, order, version.current);
      const others = release();
      if (result.ok) { version.current = result.value.version; change((_, currentItems) => ({ album: result.value, items: currentItems })); return; }
      announce(result.error.message);
      if (others === 0) await load();
    });
  };
  const setCover = async (item: AlbumItem) => {
    await moves.current;
    const result = await gateway.albums.updateAlbum(album.id, { coverItemId: item.id }, version.current);
    if (!result.ok) { announce(result.error.message); await load(); return; }
    version.current = result.value.version;
    change((_, currentItems) => ({ album: result.value, items: currentItems }));
    announce(`「${item.originalName}」を表紙にしました`);
  };
  const removeItem = async (item: AlbumItem) => {
    const result = await gateway.albums.deleteItem(album.id, item.id);
    if (!result.ok) { announce(result.error.message); return; }
    setDeletedItem(item);
    await load();
  };
  const restoreItem = async () => {
    if (!deletedItem) return;
    const result = await gateway.albums.restoreItem(album.id, deletedItem.id);
    if (!result.ok) { announce(result.error.message); return; }
    setDeletedItem(null);
    await load();
    announce(`「${result.value.originalName}」を元に戻しました`);
  };
  const save = async (draft: AlbumDraft) => {
    if (busy) return;
    setBusy(true); setFormError('');
    await moves.current;
    const result = await gateway.albums.updateAlbum(album.id, albumDraftToUpdateInput(draft, album), version.current);
    setBusy(false);
    if (!result.ok) { setFormError(result.error.message); return; }
    version.current = result.value.version;
    change((_, currentItems) => ({ album: result.value, items: currentItems }));
    setPanel(null);
    announce('アルバムを保存しました');
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    await moves.current;
    const result = await gateway.albums.deleteAlbum(album.id, version.current);
    setBusy(false);
    if (!result.ok) { announce(result.error.message); return; }
    setPanel(null);
    onDeleted(album);
    navigate('/albums');
  };
  const saveAll = async () => {
    stopSaving.current = false;
    setSaving({ done: 0, total: ready.length });
    let done = 0;
    for (const item of ready) {
      if (stopSaving.current) break;
      saveFile(gateway.albums.mediaUrl(item, 'file'), item.originalName);
      done += 1;
      setSaving({ done, total: ready.length });
      await new Promise((resolve) => { setTimeout(resolve, SAVE_INTERVAL_MS); });
    }
    setSaving(null);
    announce(`${done}件の保存を始めました。保存先はブラウザの設定によります。`);
  };
  const closeViewer = (lastId: Id | undefined) => {
    setViewing(null);
    // 検索から ?item= で開いたときは、URL から外す。履歴を積まずに置き換えるので、戻るで表示画面が開き直らない。
    if (new URLSearchParams(window.location.search).has('item')) navigate(withQueryParam('item', null), true, true);
    // 見ていた項目へ戻す。消えていたら見出しへ。
    window.setTimeout(() => {
      const tile = lastId ? document.querySelector<HTMLElement>(`[data-control-id="albums.item.open.${lastId}"]`) : null;
      (tile ?? heading.current)?.focus();
    }, 60);
  };
  useEffect(() => () => { stopSaving.current = true; }, []);

  const description = [album.description, audienceText('album', album.visibility, (id) => memberName(snapshot, id))].filter(Boolean).join(' · ');
  return <div className="page">
    <a data-control-id="albums.detail.back" className="button album-back" href="/albums" data-link><ChevronLeftIcon width="16"/>アルバムの一覧</a>
    <PageHeader eyebrow="アルバム" title={album.title} description={description || audienceLabel('album', album.visibility.audience)}/>
    <h2 className="sr-only" ref={heading} tabIndex={-1}>写真と動画</h2>
    <div className="album-actions">
      {canUpload && <button data-control-id="albums.detail.upload" className="button primary" type="button" onClick={() => setPanel('upload')}><UploadIcon width="17"/>写真や動画を追加</button>}
      <button data-control-id="albums.detail.slideshow" className="button" type="button" disabled={ready.length === 0} onClick={() => setShowing(true)}><PlayIcon width="17"/>スライドショー</button>
      {saving
        ? <button data-control-id="albums.detail.save-all.stop" className="button" type="button" onClick={() => { stopSaving.current = true; }}>{saving.done} / {saving.total}件 保存中（止める）</button>
        : <button data-control-id="albums.detail.save-all" className="button" type="button" disabled={ready.length === 0} onClick={() => void saveAll()}><DownloadIcon width="17"/>すべて端末に保存</button>}
      {organizable && ready.length > 0 && <button data-control-id="albums.detail.organize" className="button" type="button" aria-pressed={organizing} onClick={() => setOrganizing((value) => !value)}>並べ替え・整理</button>}
      {canEdit && <button data-control-id="albums.detail.edit" className="button" type="button" onClick={() => { setFormError(''); setPanel('edit'); }}><SettingsIcon width="17"/>編集</button>}
      {canDeleteAlbum && <button data-control-id="albums.detail.delete" className="button danger" type="button" onClick={() => setPanel('delete')}><TrashIcon width="17"/>アルバムを削除</button>}
    </div>
    {saving && <p className="small muted" role="status">1件ずつ保存しています。ブラウザが複数の保存の許可を求めることがあります。</p>}
    {activeUploads > 0 && !panel && <div className="callout info" role="status"><UploadIcon/><div><strong>{activeUploads}件を送っています</strong><p className="small muted mb-0">アルバムの画面を離れると、送信は止まります。</p></div><button data-control-id="albums.detail.upload-status" className="button" type="button" onClick={() => setPanel('upload')}>状況を見る</button></div>}
    {deletedItem && <div className="callout info" role="status"><ImageIcon/><div><strong>「{deletedItem.originalName}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id="albums.item.restore" className="button" type="button" onClick={() => void restoreItem()}>{ja.actions.restore}</button></div>}

    <div className="album-view-controls">
      <div className="segmented album-filter" role="group" aria-label="表示する種類">{albumFilters.map((value) => <button data-control-id={`albums.filter.${value}`} key={value} type="button" aria-pressed={filter === value} onClick={() => navigate(withQueryParam('filter', value === 'all' ? null : value), true, true)}>{filterLabels[value]} {counts[value]}</button>)}</div>
      {!organizing && <div className="segmented album-sort" role="group" aria-label={captureTimeCopy.sortLabel} aria-describedby={sort === 'taken' ? 'album-sort-note' : undefined}>{albumSorts.map((value) => <button data-control-id={`albums.sort.${value}`} key={value} type="button" aria-pressed={sort === value} onClick={() => navigate(withQueryParam('sort', value === 'album' ? null : value), true, true)}>{captureTimeCopy.sort[value]}</button>)}</div>}
    </div>
    {sort === 'taken' && !organizing && <p className="small muted album-sort-note" id="album-sort-note">{captureTimeCopy.sortNote}</p>}

    {shown.length === 0
      ? <EmptyState title={filter === 'all' ? 'まだ写真や動画はありません' : `${filterLabels[filter]}はありません`} illustration={<EmptyAlbums/>} action={filter === 'all' && canUpload ? <button data-control-id="albums.detail.upload-empty" className="button primary" type="button" onClick={() => setPanel('upload')}>写真や動画を追加</button> : undefined}>{filter === 'all' ? '追加すると、ここに並びます。' : 'ほかの種類を選んでください。'}</EmptyState>
      : organizing
        ? <ul className="album-organize">{shown.map((item, index) => <li className="album-organize-row" key={item.id}>
          <span className="album-organize-thumb"><ItemImage item={item}/></span>
          <div className="row-main"><strong className="file-name">{item.originalName}</strong><span className="meta">{itemKindLabel(item)}{item.status === 'processing' ? ' · 確認しています…' : ''}{album.coverItemId === item.id ? ' · 表紙' : ''}</span></div>
          <div className="album-organize-actions">
            {canEdit && <>
              <button data-control-id={`albums.item.move-earlier.${item.id}`} className="button" type="button" disabled={index === 0} aria-label={`${item.originalName}を前へ移動`} onClick={() => move(item.id, -1)}><ChevronLeftIcon width="16"/>前へ</button>
              <button data-control-id={`albums.item.move-later.${item.id}`} className="button" type="button" disabled={index === shown.length - 1} aria-label={`${item.originalName}を後ろへ移動`} onClick={() => move(item.id, 1)}><ChevronRightIcon width="16"/>後ろへ</button>
              <button data-control-id={`albums.item.cover.${item.id}`} className="button" type="button" disabled={item.status !== 'ready' || !item.hasThumbnail || album.coverItemId === item.id} aria-label={`${item.originalName}を表紙にする`} onClick={() => void setCover(item)}>表紙にする</button>
            </>}
            {canDeleteItem(item) && <button data-control-id={`albums.item.delete.${item.id}`} className="button danger" type="button" aria-label={`${item.originalName}を削除`} onClick={() => void removeItem(item)}>削除</button>}
          </div>
        </li>)}</ul>
        : <ul className="album-grid">{shown.map((item) => <li className="album-tile" key={item.id}>
          {item.status === 'ready'
            ? <button data-control-id={`albums.item.open.${item.id}`} className="album-tile-media" type="button" aria-label={`${itemKindLabel(item)}「${item.originalName}」を開く`} onClick={() => setViewing(item.id)}>
              <ItemImage item={item}/>
              {item.kind === 'video' && <span className="album-tile-mark"><VideoIcon/></span>}
              {album.coverItemId === item.id && <span className="album-tile-cover">表紙</span>}
            </button>
            : <div className="album-tile-media"><ItemImage item={item}/><span className="album-tile-status"><StatusBadge tone="attention">確認しています…</StatusBadge></span></div>}
          {item.locationKept && <span className="album-location"><MapPinIcon width="13"/>撮影場所を残しています</span>}
        </li>)}</ul>}

    {rejected.length > 0 && <section className="card flat album-rejected"><h2>保存できなかったファイル</h2><ul className="list">{rejected.map((item) => <li className="list-row" key={item.id}><LockIcon width="20"/><div className="row-main"><strong className="file-name">{item.originalName}</strong><span className="field-error">{item.statusMessage}</span></div>{canDeleteItem(item) && <button data-control-id={`albums.rejected.remove.${item.id}`} className="button" type="button" aria-label={`${item.originalName}を一覧から外す`} onClick={() => void removeItem(item)}>外す</button>}</li>)}</ul></section>}

    {panel === 'upload' && <AlbumUpload albumId={album.id} uploads={uploads} onClose={() => setPanel(null)}/>}
    {panel === 'edit' && <Dialog title="アルバムを編集" onClose={() => { if (!busy) setPanel(null); }}><AlbumForm formId={album.id} initial={albumToDraft(album)} submitLabel="保存する" busyLabel="保存中…" busy={busy} error={formError} onSubmit={(draft) => void save(draft)} onCancel={() => setPanel(null)}/></Dialog>}
    {panel === 'delete' && <Dialog title="アルバムを削除しますか" description={`「${album.title}」と、中の写真や動画を削除します。`} onClose={() => { if (!busy) setPanel(null); }} actions={<>
      <button data-control-id="albums.delete.cancel" className="button" type="button" disabled={busy} onClick={() => setPanel(null)}>{ja.actions.cancel}</button>
      <button data-control-id="albums.delete.confirm" className="button danger" type="button" disabled={busy} onClick={() => void remove()}>{ja.actions.delete}</button>
    </>}><p className="muted">7日以内なら元に戻せます。</p></Dialog>}
    {viewing && <MediaViewer items={viewable} startId={viewing} canDelete={canDeleteItem} onDelete={(item) => void removeItem(item)} undo={deletedItem} onUndo={() => void restoreItem()} onClose={closeViewer}/>}
    {showing && <Slideshow album={album} items={ready} onClose={() => setShowing(false)}/>}
  </div>;
}
