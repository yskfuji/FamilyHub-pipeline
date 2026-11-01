import { useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { bgmLabels, ja } from '../../content/ja';
import { albumDraftProblem, type AlbumDraft } from '../../domain/albumForm';
import type { BgmPreset } from '../../domain/types';
import { VisibilityFields } from '../shared/VisibilityFields';

interface Props {
  /** 操作の ID の末尾に使う。新規は new。 */
  formId: string;
  initial: AlbumDraft;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string;
  onSubmit: (draft: AlbumDraft) => void;
  onCancel: () => void;
}

const presets = Object.keys(bgmLabels) as BgmPreset[];

export function AlbumForm({ formId, initial, submitLabel, busyLabel, busy, error, onSubmit, onCancel }: Props) {
  const { snapshot } = useApp();
  const [draft, setDraft] = useState(initial);
  const [problem, setProblem] = useState('');
  const patch = (changes: Partial<AlbumDraft>) => setDraft((current) => ({ ...current, ...changes }));
  const people = snapshot.memberships.filter((member) => member.status === 'active' || draft.selectedIds.includes(member.id));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = albumDraftProblem(draft);
    setProblem(found ?? '');
    if (!found) onSubmit(draft);
  };
  const shown = problem || error;
  return <form className="stack" aria-busy={busy} noValidate onSubmit={submit}>
    <label className="field"><span>アルバム名</span><input data-control-id={`albums.form.title.${formId}`} className="input" name="title" autoFocus required maxLength={120} value={draft.title} onChange={(event) => patch({ title: event.target.value })}/></label>
    <label className="field"><span>説明（任意）</span><textarea data-control-id={`albums.form.description.${formId}`} className="textarea" name="description" maxLength={2000} value={draft.description} onChange={(event) => patch({ description: event.target.value })}/></label>
    <VisibilityFields kind="album" formId={formId} audience={draft.audience} selectedIds={draft.selectedIds} initialAudience={initial.audience} people={people} onChange={(changes) => patch(changes as Partial<AlbumDraft>)}/>
    <label className="field"><span>スライドショーの曲</span><select data-control-id={`albums.form.bgm.${formId}`} className="select" aria-describedby={`album-bgm-help-${formId}`} value={draft.bgmPreset} onChange={(event) => patch({ bgmPreset: event.target.value as AlbumDraft['bgmPreset'] })}>
      <option value="">指定しない</option>
      {presets.map((preset) => <option key={preset} value={preset}>{bgmLabels[preset]}</option>)}
    </select><span className="field-help" id={`album-bgm-help-${formId}`}>再生ボタンを押すまで音は鳴りません。</span></label>
    {shown && <p className="field-error" role="alert">{shown}</p>}
    <div className="dialog-actions">
      <button data-control-id={`albums.form.cancel.${formId}`} className="button" type="button" disabled={busy} onClick={onCancel}>{ja.actions.cancel}</button>
      <button data-control-id={`albums.form.submit.${formId}`} className="button primary" type="submit" disabled={busy}>{busy ? busyLabel : submitLabel}</button>
    </div>
  </form>;
}
