import { useEffect, useEffectEvent, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { memberName, useApp } from '../../app/AppContext';
import { captureTimeCopy, ja } from '../../content/ja';
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

interface FrameProps {
  /** 読み上げる名前（例:「写真を表示」）。 */
  label: string;
  /** Esc で閉じるとき。開いている補足を先に閉じるなど。 */
  onEscape: () => void;
  controlsShown?: boolean;
  /** 上の帯の左に置く閉じるボタン。操作の ID は画面ごとに違うので、呼ぶ側が作る。 */
  closeButton: ReactNode;
  /** 帯の中央（件数・名前・撮影日時など）。 */
  title: ReactNode;
  /** 帯の右の操作。 */
  actions?: ReactNode;
  /** 表示する本体。 */
  children: ReactNode;
  /** 本体の外に重ねるもの（前後のボタン・詳しい情報・元に戻す）。 */
  overlay?: ReactNode;
  stageClassName?: string;
  onTouchStart?: (event: TouchEvent) => void;
  onTouchEnd?: (event: TouchEvent) => void;
}

/**
 * 写真・動画・添付を全画面で表示する枠。アルバムの表示画面とメモの添付の表示（A14）が同じものを使う。
 * 暗い地で、Esc と閉じるボタンで閉じ、閉じると開いたボタンへ焦点を戻す（useModalBehavior）。
 */
export function MediaFrame({ label, onEscape, controlsShown = true, closeButton, title, actions, children, overlay, stageClassName, onTouchStart, onTouchEnd }: FrameProps) {
  const root = useModalBehavior(onEscape);
  return createPortal(<div ref={root as React.RefObject<HTMLDivElement>} data-modal-root data-theme="dusk" className="media-screen" data-controls={controlsShown ? 'shown' : 'hidden'} role="dialog" aria-modal="true" aria-label={label}>
    <div className={`media-stage${stageClassName ? ` ${stageClassName}` : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>{children}</div>
    <header className="media-bar">
      {closeButton}
      {title}
      {actions && <div className="media-bar-actions">{actions}</div>}
    </header>
    {overlay}
  </div>, document.body);
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
  const taken = item.takenAt ? formatItemDate(item.takenAt) : null;
  const sourceNote = item.takenAt && item.takenAtSource ? captureTimeCopy.sourceNote[item.takenAtSource] : undefined;
  return <MediaFrame label={`${itemKindLabel(item)}を表示`} onEscape={() => { if (info) setInfo(false); else close(); }} controlsShown={controlsShown}
    onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
    closeButton={<button data-control-id="albums.viewer.close" data-autofocus className="icon-button" type="button" aria-label={ja.actions.close} onClick={close}><CloseIcon/></button>}
    title={<>
      <p className="media-count" aria-live="polite"><span className="sr-only">{item.originalName} </span>{index + 1} / {items.length}</p>
      <div className="media-title"><p className="media-name">{item.originalName}</p>{taken && <p className="media-taken">{captureTimeCopy.taken(taken)}{sourceNote ? captureTimeCopy.estimated : ''}</p>}</div>
    </>}
    actions={<>
      <button data-control-id="albums.viewer.info" className="icon-button" type="button" aria-label="詳しい情報" aria-expanded={info} onClick={() => setInfo((value) => !value)}><InfoIcon/></button>
      <a data-control-id="albums.viewer.download" className="icon-button" href={fileUrl} download={item.originalName} aria-label={`${item.originalName}を端末に保存`}><DownloadIcon/></a>
      {item.kind === 'video' && pipSupported && <button data-control-id="albums.viewer.pip" className="icon-button" type="button" aria-label="小さな窓で再生" onClick={() => void togglePictureInPicture()}><PipIcon/></button>}
      {canDelete(item) && <button data-control-id="albums.viewer.delete" className="icon-button" type="button" aria-label={`${item.originalName}を削除`} onClick={remove}><TrashIcon/></button>}
    </>}
    overlay={<>
      {items.length > 1 && <>
        <button data-control-id="albums.viewer.previous" className="icon-button media-side previous" type="button" aria-label="前の項目" onClick={() => go(-1)}><ChevronLeftIcon/></button>
        <button data-control-id="albums.viewer.next" className="icon-button media-side next" type="button" aria-label="次の項目" onClick={() => go(1)}><ChevronRightIcon/></button>
      </>}
      {info && <aside className="media-info" aria-label="詳しい情報"><dl className="detail-list">
        <div><dt>名前</dt><dd className="file-name">{item.originalName}</dd></div>
        <div><dt>大きさ</dt><dd>{formatFileSize(item.byteSize)}{item.width && item.height ? ` · ${item.width}×${item.height}` : ''}</dd></div>
        <div><dt>{taken ? captureTimeCopy.heading : captureTimeCopy.added}</dt><dd>{taken ?? formatItemDate(item.createdAt)}{sourceNote && <span className="media-source-note">{sourceNote}</span>}</dd></div>
        <div><dt>追加した人</dt><dd>{memberName(snapshot, item.uploaderMembershipId)}</dd></div>
        <div><dt>撮影場所</dt><dd>{location}</dd></div>
      </dl></aside>}
      {undo && <div className="media-undo" role="status"><span>「{undo.originalName}」を削除しました</span><button data-control-id="albums.viewer.undo" className="button" type="button" onClick={onUndo}>{ja.actions.restore}</button></div>}
    </>}>
    {item.kind === 'video'
      ? <video key={item.id} ref={video} className="media-full" src={fileUrl} poster={item.hasThumbnail ? gateway.albums.mediaUrl(item, 'thumbnail') : undefined} controls playsInline preload="metadata" aria-label={item.originalName}/>
      : failedId === item.id
        ? <p className="media-failed">この写真を読み込めませんでした。</p>
        : <img key={item.id} className="media-full" src={fileUrl} alt={item.originalName} onError={() => setFailedId(item.id)}/>}
  </MediaFrame>;
}
