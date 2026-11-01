import { useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { attachmentStatusLabels, ja } from '../../content/ja';
import { Dialog, StatusBadge } from '../../design-system/components';
import { FileIcon, ImageIcon, ShieldIcon, UploadIcon } from '../../design-system/icons';
import { attachmentAccept, attachmentLimitsText, formatFileSize } from '../../domain/memoAttachments';
import type { Attachment, Memo } from '../../domain/types';
import type { AttachmentQueue, QueuedFile } from './useAttachmentQueue';

const tone = (status: Attachment['status']) => (status === 'clean' ? 'success' : status === 'rejected' ? 'danger' : status === 'quarantined' ? 'attention' : 'neutral');
const queuedLabel: Record<QueuedFile['state'], string> = { waiting: '順番を待っています', sending: '送っています…', failed: '送れませんでした' };

interface Props {
  memo: Memo;
  canAttach: boolean;
  queue: AttachmentQueue;
}

function QueuedRow({ item, queue }: { item: QueuedFile; queue: AttachmentQueue }) {
  const failed = item.state === 'failed';
  return <li className="list-row attachment-row">
    <FileIcon width="23"/>
    <div className="row-main"><strong className="file-name">{item.file.name}</strong><span className={failed ? 'field-error' : 'meta'}>{formatFileSize(item.file.size)} · {item.message ?? queuedLabel[item.state]}</span></div>
    {failed && <div className="attachment-actions">
      {item.retryable && <button data-control-id={`notes.attachment.retry.${item.key}`} className="button" type="button" aria-label={`${item.file.name}をもう一度送る`} onClick={() => queue.retry(item.key)}>{ja.actions.retry}</button>}
      <button data-control-id={`notes.attachment.discard.${item.key}`} className="button" type="button" aria-label={`${item.file.name}を取り除く`} onClick={() => queue.discard(item.key)}>取り除く</button>
    </div>}
  </li>;
}

export function MemoAttachments({ memo, canAttach, queue }: Props) {
  const { gateway, refresh, announce } = useApp();
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const queued = queue.items.filter((item) => item.memoId === memo.id);
  const empty = memo.attachments.length === 0 && queued.length === 0;

  const open = async (attachment: Attachment) => {
    const result = await gateway.memos.getAttachmentLink(memo.id, attachment.id);
    if (!result.ok) { announce(result.error.message); return; }
    window.open(result.value.url, '_blank', 'noopener,noreferrer');
  };
  const remove = async () => {
    if (!removing || busy) return;
    setBusy(true);
    const result = await gateway.memos.deleteAttachment(memo.id, removing.id);
    setBusy(false);
    if (!result.ok) { announce(result.error.message); return; }
    const name = removing.originalName;
    setRemoving(null);
    await refresh();
    announce(`「${name}」を削除しました`);
  };

  return <section className="card flat">
    <div className="section-head">
      <h3>添付ファイル</h3>
      {canAttach && <>
        <button data-control-id={`notes.attachment.choose.${memo.id}`} className="button" type="button" onClick={() => picker.current?.click()}><UploadIcon width="17"/>ファイルを追加</button>
        <input data-control-id={`notes.attachment.file.${memo.id}`} ref={picker} className="sr-only" type="file" multiple tabIndex={-1} aria-label="添付するファイルを選択" accept={attachmentAccept} onChange={(event) => { queue.add(memo.id, [...event.target.files ?? []]); event.target.value = ''; }}/>
      </>}
    </div>
    {empty ? <p className="muted">添付ファイルはありません。</p> : <ul className="list" aria-live="polite">
      {memo.attachments.map((attachment) => <li className="list-row attachment-row" key={attachment.id}>
        {attachment.mimeType.startsWith('image/') ? <ImageIcon width="23"/> : <FileIcon width="23"/>}
        <div className="row-main"><strong className="file-name">{attachment.originalName}</strong><span className="meta">{formatFileSize(attachment.byteSize)} · {attachment.statusMessage}</span></div>
        <div className="attachment-actions">
          {attachment.status === 'clean'
            ? <button data-control-id={`notes.attachment.open.${attachment.id}`} className="button" type="button" aria-label={`${attachment.originalName}を開く（新しいタブ）`} onClick={() => void open(attachment)}>開く</button>
            : <StatusBadge tone={tone(attachment.status)}>{attachmentStatusLabels[attachment.status]}</StatusBadge>}
          {canAttach && <button data-control-id={`notes.attachment.delete.open.${attachment.id}`} className="button danger" type="button" aria-label={`${attachment.originalName}を削除`} onClick={() => setRemoving(attachment)}>削除</button>}
        </div>
      </li>)}
      {queued.map((item) => <QueuedRow item={item} queue={queue} key={item.key}/>)}
    </ul>}
    {queued.some((item) => item.state === 'failed' && item.retryable) && <p className="small muted">送れなかったファイルは、この画面を離れるまで残ります。メモは作り直さずに送り直せます。</p>}
    <div className="callout info mt-1"><ShieldIcon/><div><strong>確認が終わるまでファイルは開けません</strong><p className="small muted mb-0">{attachmentLimitsText}共有相手の範囲も確認してください。</p></div></div>
    {removing && <Dialog title="添付ファイルを削除しますか" description={`「${removing.originalName}」を削除します。`} onClose={() => { if (!busy) setRemoving(null); }} actions={<>
      <button data-control-id={`notes.attachment.delete.cancel.${removing.id}`} className="button" type="button" disabled={busy} onClick={() => setRemoving(null)}>{ja.actions.cancel}</button>
      <button data-control-id={`notes.attachment.delete.confirm.${removing.id}`} className="button danger" type="button" disabled={busy} onClick={() => void remove()}>{ja.actions.delete}</button>
    </>}><p className="muted">添付ファイルの削除は元に戻せません。</p></Dialog>}
  </section>;
}
