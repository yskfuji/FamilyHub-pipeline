import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { Dialog } from '../../design-system/components';
import { READING_IMAGE_ACCEPT, readingImageProblem, receiptToDraft } from '../../domain/assistant';
import { ReadingNotice, reviewNote } from './ReadingNotice';
import { useReadingJob, useReadingStatus } from './useReading';

function ReceiptDialog({ sample, onClose }: { sample: boolean; onClose: () => void }) {
  const { gateway, requestQuickCreate } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const { busy, run } = useReadingJob();
  const read = async () => {
    if (!file || busy) return;
    const problem = readingImageProblem(file);
    if (problem) { setError(problem); return; }
    setError('');
    const result = await run(() => gateway.assistant.readReceipt(file));
    if (!result) return;
    if (!result.ok) { setError(result.error.message); return; }
    if (!result.value.receipt) { setError('読み取れませんでした。写りや内容を確かめて、もう一度お試しください。'); return; }
    onClose();
    requestQuickCreate('expense', undefined, 'expense', { expense: receiptToDraft(result.value.receipt), note: reviewNote(Boolean(result.value.sample)) });
  };
  return <Dialog title="領収書を読み取る" description="金額・日付・店名・費目を読み取り、支出の入力に入れます。" onClose={onClose}>
    <div className="stack" aria-busy={busy}>
      <ReadingNotice sample={sample}/>
      <label className="field"><span>領収書の画像</span><input data-control-id="assistant.receipt.file" className="input" type="file" accept={READING_IMAGE_ACCEPT} disabled={busy} aria-describedby="receipt-file-help" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); }}/><span className="field-help" id="receipt-file-help">JPEG と PNG を読み取れます（10MBまで）。</span></label>
      {busy && <p className="small muted mb-0" role="status">読み取っています。しばらくお待ちください。</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button data-control-id="assistant.receipt.cancel" className="button" type="button" onClick={onClose}>{ja.actions.cancel}</button>
        <button data-control-id="assistant.receipt.submit" className="button primary" type="button" disabled={!file || busy} onClick={() => void read()}>{busy ? '読み取り中…' : '読み取る'}</button>
      </div>
    </div>
  </Dialog>;
}

/** 使える人にだけ出す。読み取った内容は支出の入力に入れるだけで、保存は利用者が行う。 */
export function ReceiptReader() {
  const { can } = useApp();
  const status = useReadingStatus();
  const [open, setOpen] = useState(false);
  if (!status?.available || !can('assistant.use') || !can('expense.create')) return null;
  return <>
    <button data-control-id="assistant.receipt.open" className="button" type="button" onClick={() => setOpen(true)}>領収書を読み取る</button>
    {open && <ReceiptDialog sample={Boolean(status.sample)} onClose={() => setOpen(false)}/>}
  </>;
}
