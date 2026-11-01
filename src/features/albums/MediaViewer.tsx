import { useEffect, useEffectEvent, useRef, useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { memberName, useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { useModalBehavior } from '../../design-system/components';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, InfoIcon, PipIcon, TrashIcon } from '../../design-system/icons';
import { neighborAfterRemoval, stepIndex, swipeStep } from '../../domain/albumView';
import { formatFileSize } from '../../domain/memoAttachments';
import type { AlbumItem, Id } from '../../domain/types';
import { formatItemDate, itemKindLabel } from './albumLabels';
import { useIdleControls } from './useIdleControls';

/** 動画の操作の列の高さ。ここから始めた払いは、再生位置の操作として扱う。 */
const VIDEO_BAR_HEIGHT = 72;

interface Props {
  items: readonly AlbumItem[];
  startId: Id;
  canDelete: (item: AlbumItem) => boolean;
  onDelete: (item: AlbumItem) => void;
  undo: AlbumItem | null;
  onUndo: () => void;
  /** 最後に見ていた項目を渡す。 */
  onClose: (lastId: Id | undefined) => void;
}

export const shouldIgnoreArrowKeys = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('video, input, select, textarea') !== null;

export function MediaViewer({ items, startId, canDelete, onDelete, undo, onUndo, onClose }: Props) {
  const { snapshot, gateway, announce } = useApp();
  const [currentId, setCurrentId] = useState(startId);
  const [info, setInfo] = useState(false);
  const [failedId, setFailedId] = useState<Id | null>(null);
  const [pipSupported] = useState(() => document.pictureInPictureEnabled === true);
  const video = useRef<HTMLVideoElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const found = items.findIndex((item) => item.id === currentId);
  const index = Math.max(0, found);
  const item = items[index];
  const close = () => onClose(item?.id);
  const root = useModalBehavior(() => { if (info) setInfo(false); else close(); });
  const controlsShown = useIdleControls(info);
  const go = (step: number) => { const next = items[stepIndex(index, items.length, step)]; if (next) setCurrentId(next.id); };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (shouldIgnoreArrowKeys(event.target)) return;
    if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  const closeWhenEmpty = useEffectEvent(() => onClose(undefined));
  const empty = items.length === 0;
  useEffect(() => { if (empty) closeWhenEmpty(); }, [empty]);

  const onTouchStart = (event: TouchEvent) => {
    const start = event.changedTouches[0];
    const target = event.target as HTMLElement;
    const onVideoBar = target.tagName === 'VIDEO' && start.clientY > target.getBoundingClientRect().bottom - VIDEO_BAR_HEIGHT;
    touch.current = onVideoBar ? null : { x: start.clientX, y: start.clientY };
  };
  const onTouchEnd = (event: TouchEvent) => {
    if (!touch.current) return;
    const end = event.changedTouches[0];
    const step = swipeStep(end.clientX - touch.current.x, end.clientY - touch.current.y);
    touch.current = null;
    if (step) go(step);
  };
  const togglePictureInPicture = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch {
      announce('小さな窓で再生できませんでした。動画の読み込みを待ってからお試しください。');
    }
  };
  const remove = () => {
    const next = neighborAfterRemoval(items, item.id);
    if (next) setCurrentId(next.id);
    onDelete(item);
  };

  if (!item) return null;
  const fileUrl = gateway.albums.mediaUrl(item, 'file');
  const location = item.locationKept ? '撮影場所を残しています' : '撮影場所は取り除いて保存しています';
  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root data-theme="dusk" className="media-screen" data-controls={controlsShown ? 'shown' : 'hidden'} role="dialog" aria-modal="true" aria-label={`${itemKindLabel(item)}を表示`}>
    <div className="media-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {item.kind === 'video'
        ? <video key={item.id} ref={video} className="media-full" src={fileUrl} poster={item.hasThumbnail ? gateway.albums.mediaUrl(item, 'thumbnail') : undefined} controls playsInline preload="metadata" aria-label={item.originalName}/>
        : failedId === item.id
          ? <p className="media-failed">この写真を読み込めませんでした。</p>
          : <img key={item.id} className="media-full" src={fileUrl} alt={item.originalName} onError={() => setFailedId(item.id)}/>}
    </div>
    <header className="media-bar">
      <button data-control-id="albums.viewer.close" data-autofocus className="icon-button" type="button" aria-label={ja.actions.close} onClick={close}><CloseIcon/></button>
      <p className="media-count" aria-live="polite"><span className="sr-only">{item.originalName} </span>{index + 1} / {items.length}</p>
      <p className="media-name">{item.originalName}</p>
      <div className="media-bar-actions">
        <button data-control-id="albums.viewer.info" className="icon-button" type="button" aria-label="詳しい情報" aria-expanded={info} onClick={() => setInfo((value) => !value)}><InfoIcon/></button>
        <a data-control-id="albums.viewer.download" className="icon-button" href={fileUrl} download={item.originalName} aria-label={`${item.originalName}を端末に保存`}><DownloadIcon/></a>
        {item.kind === 'video' && pipSupported && <button data-control-id="albums.viewer.pip" className="icon-button" type="button" aria-label="小さな窓で再生" onClick={() => void togglePictureInPicture()}><PipIcon/></button>}
        {canDelete(item) && <button data-control-id="albums.viewer.delete" className="icon-button" type="button" aria-label={`${item.originalName}を削除`} onClick={remove}><TrashIcon/></button>}
      </div>
    </header>
    {items.length > 1 && <>
      <button data-control-id="albums.viewer.previous" className="icon-button media-side previous" type="button" aria-label="前の項目" onClick={() => go(-1)}><ChevronLeftIcon/></button>
      <button data-control-id="albums.viewer.next" className="icon-button media-side next" type="button" aria-label="次の項目" onClick={() => go(1)}><ChevronRightIcon/></button>
    </>}
    {info && <aside className="media-info" aria-label="詳しい情報"><dl className="detail-list">
      <div><dt>名前</dt><dd className="file-name">{item.originalName}</dd></div>
      <div><dt>大きさ</dt><dd>{formatFileSize(item.byteSize)}{item.width && item.height ? ` · ${item.width}×${item.height}` : ''}</dd></div>
      <div><dt>{item.takenAt ? '撮影日' : '追加日'}</dt><dd>{formatItemDate(item.takenAt ?? item.createdAt)}</dd></div>
      <div><dt>追加した人</dt><dd>{memberName(snapshot, item.uploaderMembershipId)}</dd></div>
      <div><dt>撮影場所</dt><dd>{location}</dd></div>
    </dl></aside>}
    {undo && <div className="media-undo" role="status"><span>「{undo.originalName}」を削除しました</span><button data-control-id="albums.viewer.undo" className="button" type="button" onClick={onUndo}>{ja.actions.restore}</button></div>}
  </div>, document.body);
}
