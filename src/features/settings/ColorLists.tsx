import { useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { ja } from '../../content/ja';
import { Dialog } from '../../design-system/components';
import { useUnsavedGuard } from '../../design-system/unsavedGuard';
import { colorLabelInputSchema } from '../../domain/schemas';
import type { ColorLabel } from '../../domain/types';

/** 選べる色。予定とタスクの印に使う。 */
const palette: ReadonlyArray<readonly [string, string]> = [
  ['#c0392b', '赤'], ['#c2571a', '橙'], ['#a9791b', '黄土'], ['#6f7552', 'オリーブ'], ['#2e7d4f', '緑'], ['#1f7a7a', '青緑'],
  ['#315c80', '藍'], ['#2f6db5', '青'], ['#5b5bb5', '紫'], ['#8a6680', '藤'], ['#b0487a', '桃'], ['#6b6358', '茶'],
];

type Editing = { label: ColorLabel | null; name: string; color: string };

function ColorListForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { gateway, refresh, announce } = useApp();
  const [name, setName] = useState(editing.name);
  const [color, setColor] = useState(editing.color);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const unsaved = useUnsavedGuard({ name, color }, busy);
  // 今の色が選択肢にないときも、変えずに保存できるように残す。
  const choices = palette.some(([value]) => value === editing.color) ? palette : [[editing.color, '今の色'] as const, ...palette];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = colorLabelInputSchema.safeParse({ name, color });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '入力内容を確認してください。'); return; }
    setBusy(true); setError('');
    const result = editing.label ? await gateway.family.updateColorLabel(editing.label.id, parsed.data) : await gateway.family.createColorLabel(parsed.data);
    setBusy(false);
    if (!result.ok) { setError(result.error.message); return; }
    await refresh();
    onClose();
    announce(`リスト「${result.value.name}」を保存しました。`);
  };
  return <Dialog title={editing.label ? 'リストを編集' : 'リストを追加'} description="予定とタスクに付ける色と名前です。" onClose={() => { if (!busy) onClose(); }}>
    <form {...unsaved.formProps} className="stack" aria-busy={busy} noValidate onSubmit={(event) => void submit(event)}>
      <label className="field"><span>名前</span><input data-control-id="settings.color-list.name" className="input" maxLength={40} required value={name} onChange={(event) => setName(event.target.value)}/></label>
      <fieldset className="fieldset"><legend>色</legend><div className="color-palette">{choices.map(([value, label]) => <label className="color-choice" key={value}><input data-control-id={`settings.color-list.color.${value.slice(1)}`} type="radio" name="color-list-color" value={value} checked={color === value} aria-label={label} onChange={() => setColor(value)}/><span className="color-swatch" style={{ background: value }} aria-hidden="true"/></label>)}</div></fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button data-control-id="settings.color-list.cancel" className="button" type="button" disabled={busy} onClick={() => unsaved.leave(onClose)}>{ja.actions.cancel}</button>
        <button data-control-id="settings.color-list.save" className="button primary" type="submit" disabled={busy}>{busy ? ja.actions.saving : '保存する'}</button>
      </div>
    </form>
  </Dialog>;
}

/** 色のリストの管理。追加には予定の作成、変更と削除には予定の変更の権限が必要。 */
export function ColorLists() {
  const { snapshot, gateway, refresh, announce, can } = useApp();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<ColorLabel | null>(null);
  const [error, setError] = useState('');
  const canCreate = can('event.create');
  const canChange = can('event.update');
  const remove = async () => {
    if (!removing) return;
    const result = await gateway.family.deleteColorLabel(removing.id);
    if (!result.ok) { setError(result.error.message); return; }
    const { name } = removing;
    setRemoving(null);
    await refresh();
    announce(`リスト「${name}」を削除しました。`);
  };
  return <section className="card mt-1">
    <div className="section-head"><div><p className="eyebrow">色のリスト</p><h2>予定とタスクの色</h2></div>{canCreate && <button data-control-id="settings.color-list.create" className="button" type="button" onClick={() => setEditing({ label: null, name: '', color: palette[6][0] })}>リストを追加</button>}</div>
    {snapshot.colorLabels.length === 0 ? <p className="muted mb-0">リストはまだありません。</p> : <ul className="list">{snapshot.colorLabels.map((label) => <li className="list-row" key={label.id}>
      <span className="color-swatch" style={{ background: label.color }} aria-hidden="true"/>
      <div className="row-main"><strong>{label.name}</strong></div>
      {canChange && <div className="list-actions">
        <button data-control-id={`settings.color-list.edit.${label.id}`} className="button" type="button" aria-label={`リスト「${label.name}」を編集`} onClick={() => setEditing({ label, name: label.name, color: label.color })}>編集</button>
        <button data-control-id={`settings.color-list.delete.${label.id}`} className="button danger" type="button" aria-label={`リスト「${label.name}」を削除`} onClick={() => { setError(''); setRemoving(label); }}>削除</button>
      </div>}
    </li>)}</ul>}
    {editing && <ColorListForm editing={editing} onClose={() => setEditing(null)}/>}
    {removing && <Dialog title={`リスト「${removing.name}」を削除しますか`} description="使っていた予定とタスクからは色だけが外れます。記録は消えません。" onClose={() => setRemoving(null)} actions={<>
      <button data-control-id="settings.color-list.delete-cancel" className="button" type="button" onClick={() => setRemoving(null)}>{ja.actions.cancel}</button>
      <button data-control-id="settings.color-list.delete-confirm" className="button danger" type="button" onClick={() => void remove()}>{ja.actions.delete}</button>
    </>}>{error && <p className="field-error" role="alert">{error}</p>}</Dialog>}
  </section>;
}
