import { useRef, useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { FileIcon, UploadIcon } from '../../design-system/icons';
import { attachmentAccept, attachmentLimitsText, attachmentProblem, formatFileSize } from '../../domain/memoAttachments';
import { memoDraftProblem, type MemoDraft } from '../../domain/memoForm';
import { PlaceField } from '../place/PlaceField';
import { VisibilityFields } from '../shared/VisibilityFields';

interface Props {
  /** 操作の ID の末尾に使う。新規は new。 */
  formId: string;
  initial: MemoDraft;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string;
  /** 新規のとき、ファイルを一緒に選べるようにする。 */
  offerFiles?: boolean;
  onSubmit: (draft: MemoDraft, files: File[]) => void;
  onCancel: () => void;
}

export function MemoForm({ formId, initial, submitLabel, busyLabel, busy, error, offerFiles, onSubmit, onCancel }: Props) {
  const { snapshot, can } = useApp();
  const [draft, setDraft] = useState(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const patch = (changes: Partial<MemoDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const people = snapshot.memberships.filter((member) => member.status === 'active' || draft.selectedIds.includes(member.id));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = memoDraftProblem(draft);
    setProblem(found ?? '');
    if (!found) onSubmit(draft, files);
  };
  const shown = problem || error;
  return <form className="stack" aria-busy={busy} noValidate onSubmit={submit}>
    <label className="field"><span>タイトル</span><input data-control-id={`notes.form.title.${formId}`} className="input" name="title" autoFocus required maxLength={120} value={draft.title} onChange={(event) => patch({ title: event.target.value })}/></label>
    <label className="field"><span>本文</span><textarea data-control-id={`notes.form.body.${formId}`} className="textarea" name="body" required maxLength={5000} value={draft.body} onChange={(event) => patch({ body: event.target.value })}/></label>
    <div className="grid two">
      <label className="field"><span>タグ</span><input data-control-id={`notes.form.tags.${formId}`} className="input" name="tags" aria-describedby={`memo-tags-help-${formId}`} value={draft.tags} onChange={(event) => patch({ tags: event.target.value })}/><span className="field-help" id={`memo-tags-help-${formId}`}>例：学校、今週。読点またはカンマで区切ります（最大10件）</span></label>
      <label className="field"><span>日付（任意）</span><input data-control-id={`notes.form.date.${formId}`} className="input" type="date" value={draft.memoDate} onChange={(event) => patch({ memoDate: event.target.value })}/></label>
    </div>
    <VisibilityFields kind="memo" formId={formId} audience={draft.audience} selectedIds={draft.selectedIds} initialAudience={initial.audience} people={people} onChange={(changes) => patch(changes as Partial<MemoDraft>)}/>
    {can('place.read') && <PlaceField value={draft.place} onChange={(place) => patch({ place })} disabled={busy}/>}
    {offerFiles && can('memo.attach') && <div className="field">
      <span className="field-label">添付ファイル（任意）</span>
      <button data-control-id="notes.form.files.choose" className="button form-file-button" type="button" disabled={busy} onClick={() => picker.current?.click()}><UploadIcon width="17"/>ファイルを選ぶ</button>
      <input data-control-id="notes.form.files.input" ref={picker} className="sr-only" type="file" multiple tabIndex={-1} aria-label="一緒に添付するファイルを選択" accept={attachmentAccept} onChange={(event) => { const chosen = [...event.target.files ?? []]; setFiles((current) => [...current, ...chosen]); event.target.value = ''; }}/>
      <span className="field-help">{attachmentLimitsText}</span>
      {files.length > 0 && <ul className="list">{files.map((file, index) => {
        const reason = attachmentProblem(file);
        return <li className="list-row" key={`${file.name}-${index}`}><FileIcon width="23"/><div className="row-main"><strong className="file-name">{file.name}</strong><span className={reason ? 'field-error' : 'meta'}>{reason ?? formatFileSize(file.size)}</span></div><button data-control-id={`notes.form.files.remove.${index}`} className="button" type="button" aria-label={`${file.name}を選択から外す`} disabled={busy} onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}>外す</button></li>;
      })}</ul>}
    </div>}
    {shown && <p className="field-error" role="alert">{shown}</p>}
    <div className="dialog-actions">
      <button data-control-id={`notes.form.cancel.${formId}`} className="button" type="button" disabled={busy} onClick={onCancel}>{ja.actions.cancel}</button>
      <button data-control-id={`notes.form.submit.${formId}`} className="button primary" type="submit" disabled={busy}>{busy ? busyLabel : submitLabel}</button>
    </div>
  </form>;
}
