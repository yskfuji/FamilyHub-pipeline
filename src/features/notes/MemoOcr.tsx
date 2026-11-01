import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { StatusBadge } from '../../design-system/components';
import { EyeIcon } from '../../design-system/icons';
import type { Memo } from '../../domain/types';

const OCR_TEXT_MAX = 8000;

/** 文字認識の結果の表示と修正。空にして保存すると結果を外す。 */
export function MemoOcr({ memo, canEdit }: { memo: Memo; canEdit: boolean }) {
  const { gateway, refresh, announce, executeQueueable } = useApp();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!memo.ocrText && !(canEdit && memo.attachments.length)) return null;

  const save = async () => {
    if (busy || text === null) return;
    setBusy(true); setError('');
    const input = { ocrText: text.trim() ? text : null };
    const outcome = await executeQueueable({ operation: 'memo.update', summary: `メモ「${memo.title}」の文字を修正`, payload: { id: memo.id, input, expectedVersion: memo.version } }, () => gateway.memos.updateMemo(memo.id, input, memo.version));
    setBusy(false);
    if (outcome.status === 'failed') { setError(outcome.error.message); return; }
    setText(null);
    if (outcome.status === 'completed') { await refresh(); announce('文字認識の結果を修正しました'); }
  };

  return <section>
    <div className="section-head"><h3><EyeIcon width="18"/> 文字認識の結果</h3><StatusBadge>元のファイルと照合</StatusBadge></div>
    {text === null
      ? <div className="card flat">
        {memo.ocrText ? <p className="ocr-text">{memo.ocrText}</p> : <p className="muted">読み取った文字はありません。</p>}
        <p className="small muted">文字認識には誤りが含まれることがあります。重要な日時や金額は、元のファイルで確認してください。</p>
        {canEdit && <button data-control-id={`notes.ocr.edit.${memo.id}`} className="button" type="button" onClick={() => setText(memo.ocrText ?? '')}>{memo.ocrText ? '文字を修正' : '文字を入力'}</button>}
      </div>
      : <div className="card flat stack">
        <label className="field"><span>文字認識の結果を修正</span><textarea data-control-id={`notes.ocr.text.${memo.id}`} className="textarea" maxLength={OCR_TEXT_MAX} autoFocus value={text} aria-describedby={`ocr-help-${memo.id}`} onChange={(event) => setText(event.target.value)}/><span className="field-help" id={`ocr-help-${memo.id}`}>空にして保存すると、結果を外します。</span></label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="ocr-actions">
          <button data-control-id={`notes.ocr.cancel.${memo.id}`} className="button" type="button" disabled={busy} onClick={() => { setText(null); setError(''); }}>{ja.actions.cancel}</button>
          <button data-control-id={`notes.ocr.save.${memo.id}`} className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? ja.actions.saving : ja.actions.saveChanges}</button>
        </div>
      </div>}
  </section>;
}
