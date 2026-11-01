import { useRef, useState } from 'react';
import { ja } from '../../content/ja';
import { Dialog, StatusBadge } from '../../design-system/components';
import { AlertIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, UploadIcon, VideoIcon } from '../../design-system/icons';
import { albumAccept, summarizeUploads, uploadPercent, type UploadEntry, type UploadState } from '../../domain/albumUpload';
import { formatFileSize } from '../../domain/memoAttachments';
import type { Id } from '../../domain/types';
import type { AlbumUploads } from './useAlbumUploads';

const stateLabels: Record<UploadState, string> = { staged: '送る前', waiting: '順番を待っています', sending: '送っています…', processing: '確認しています…', done: '追加しました', duplicate: '同じファイルがあるため追加していません', rejected: '追加できません', failed: '送れませんでした' };
const stateTones: Partial<Record<UploadState, 'attention' | 'success' | 'danger'>> = { sending: 'attention', processing: 'attention', done: 'success', rejected: 'danger', failed: 'danger' };

function EntryRow({ entry, position, stagedCount, uploads }: { entry: UploadEntry; position: number; stagedCount: number; uploads: AlbumUploads }) {
  const { queue } = uploads;
  const { file, state } = entry;
  const percent = state === 'sending' ? uploadPercent(entry.sentBytes, file.size) : 0;
  const bad = state === 'failed' || state === 'rejected';
  return <li className="album-upload-row">
    <span className="album-upload-kind" aria-hidden="true">{state === 'done' ? <CheckIcon/> : bad ? <AlertIcon/> : file.type.startsWith('video/') ? <VideoIcon/> : <ImageIcon/>}</span>
    <div className="row-main">
      <strong className="file-name">{file.name}</strong>
      <span className="meta">{formatFileSize(file.size)}</span>
      {entry.message && <span className={bad ? 'field-error' : 'meta'}>{entry.message}</span>}
    </div>
    <StatusBadge tone={stateTones[state] ?? 'neutral'}>{stateLabels[state]}</StatusBadge>
    {state === 'sending' && <progress className="album-progress" max={100} value={percent} aria-label={`${file.name}の送信の進み具合`}/>}
    {(state === 'staged' || bad || state === 'duplicate' || state === 'done') && <div className="album-upload-actions">
      {state === 'staged' && <>
        <button data-control-id={`albums.upload.earlier.${entry.key}`} className="button" type="button" disabled={position === 0} aria-label={`${file.name}を前へ`} onClick={() => queue.move(entry.key, -1)}><ChevronLeftIcon width="16"/>前へ</button>
        <button data-control-id={`albums.upload.later.${entry.key}`} className="button" type="button" disabled={position === stagedCount - 1} aria-label={`${file.name}を後ろへ`} onClick={() => queue.move(entry.key, 1)}><ChevronRightIcon width="16"/>後ろへ</button>
      </>}
      {state === 'failed' && entry.retryable && <button data-control-id={`albums.upload.retry.${entry.key}`} className="button" type="button" aria-label={`${file.name}をもう一度送る`} onClick={() => queue.retry(entry.key)}>{ja.actions.retry}</button>}
      <button data-control-id={`albums.upload.remove.${entry.key}`} className="button" type="button" aria-label={`${file.name}を一覧から外す`} onClick={() => queue.remove(entry.key)}>外す</button>
    </div>}
  </li>;
}

export function AlbumUpload({ albumId, uploads, onClose }: { albumId: Id; uploads: AlbumUploads; onClose: () => void }) {
  const { queue } = uploads;
  const [keepLocation, setKeepLocation] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const entries = uploads.entries.filter((entry) => entry.albumId === albumId);
  const summary = summarizeUploads(entries);
  const staged = entries.filter((entry) => entry.state === 'staged');
  const started = summary.active > 0 || summary.finished > 0;
  return <Dialog title="写真や動画を追加" description="JPEG・PNG・MP4・MOV を選べます。写真は100MB、動画は4GBまでです。HEIC は受け付けていません。" onClose={onClose} actions={<>
    <button data-control-id="albums.upload.close" className="button" type="button" onClick={onClose}>{ja.actions.close}</button>
    {summary.active > 0 && <button data-control-id="albums.upload.cancel" className="button danger" type="button" onClick={() => queue.cancel(albumId)}>送信を中止</button>}
    {summary.staged > 0 && <button data-control-id="albums.upload.start" className="button primary" type="button" onClick={() => queue.start(albumId, keepLocation)}>{summary.staged}件を送る</button>}
  </>}>
    <div className="stack">
      <div>
        <button data-control-id="albums.upload.choose" className="button" type="button" onClick={() => picker.current?.click()}><UploadIcon width="17"/>ファイルを選ぶ</button>
        <input data-control-id="albums.upload.file" ref={picker} className="sr-only" type="file" multiple tabIndex={-1} aria-label="アルバムに追加するファイルを選択" accept={albumAccept} onChange={(event) => { queue.add(albumId, [...event.target.files ?? []]); event.target.value = ''; }}/>
      </div>
      <div className="field">
        <label className="check-row"><input data-control-id="albums.upload.keep-location" type="checkbox" role="switch" aria-describedby="album-keep-location-help" checked={keepLocation} onChange={(event) => setKeepLocation(event.target.checked)}/>撮影場所を残す</label>
        <span className="field-help" id="album-keep-location-help">オンにすると撮影場所の情報がファイルに残り、このアルバムを見られる人が読み取れます（オフなら取り除いて保存します）。</span>
      </div>
      {(started || summary.failed > 0) && <p className="album-upload-count" role="status">{started && <strong>{summary.finished} / {summary.total}件 完了</strong>}{summary.failed > 0 && <span className="field-error"> {summary.failed}件 追加できませんでした</span>}</p>}
      {entries.length > 0 && <ul className="list album-upload-list">{entries.map((entry) => <EntryRow key={entry.key} entry={entry} position={staged.indexOf(entry)} stagedCount={staged.length} uploads={uploads}/>)}</ul>}
      {summary.finished > 0 && summary.active === 0 && <button data-control-id="albums.upload.clear" className="button album-upload-clear" type="button" onClick={() => queue.clearFinished(albumId)}>完了した分を一覧から消す</button>}
    </div>
  </Dialog>;
}
