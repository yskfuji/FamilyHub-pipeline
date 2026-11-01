import { useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { canDeleteResource, canMutateOwnedResource } from '../../authz/policy';
import { ja } from '../../content/ja';
import { Dialog, Drawer } from '../../design-system/components';
import { LockIcon, MapPinIcon } from '../../design-system/icons';
import { memoDraftToUpdateInput, memoToDraft, type MemoDraft } from '../../domain/memoForm';
import { memoDateKey } from '../../domain/memoList';
import { keyOfPlace } from '../../domain/places';
import type { Memo } from '../../domain/types';
import { dayLabel } from '../calendar/calendarLabels';
import { PlaceAttributionLink, PlaceSummary } from '../place/PlaceField';
import { audienceText } from '../shared/visibilityText';
import { MemoAttachments } from './MemoAttachments';
import { MemoForm } from './MemoForm';
import { MemoOcr } from './MemoOcr';
import type { AttachmentQueue } from './useAttachmentQueue';

interface Props {
  memo: Memo;
  queue: AttachmentQueue;
  onClose: () => void;
  onDeleted: (memo: Memo) => void;
}

export function MemoDrawer({ memo, queue, onClose, onDeleted }: Props) {
  const { snapshot, gateway, refresh, announce, executeQueueable } = useApp();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const { viewer } = snapshot;
  const canEdit = canMutateOwnedResource(viewer, 'memo.update', memo.authorMembershipId).allowed;
  const canAttach = canMutateOwnedResource(viewer, 'memo.attach', memo.authorMembershipId).allowed;
  const canDelete = canDeleteResource(viewer, 'memo.delete', [memo.authorMembershipId]).allowed;

  const update = async (draft: MemoDraft) => {
    if (submitting) return;
    setSubmitting(true); setFormError('');
    const input = memoDraftToUpdateInput(draft, memo);
    const outcome = await executeQueueable({ operation: 'memo.update', summary: `メモ「${memo.title}」を変更`, payload: { id: memo.id, input, expectedVersion: memo.version } }, () => gateway.memos.updateMemo(memo.id, input, memo.version));
    setSubmitting(false);
    if (outcome.status === 'failed') { setFormError(outcome.error.message); return; }
    if (outcome.status === 'queued') { setEditing(false); return; }
    await refresh(); setEditing(false); announce('メモを更新しました');
  };
  const remove = async () => {
    const result = await gateway.memos.deleteMemo(memo.id);
    if (!result.ok) return announce(`${result.error.message} 削除はオフライン中に保存できません。`);
    onDeleted(memo); setDeleting(false); onClose();
    await refresh();
    announce(`「${memo.title}」を削除しました`);
  };

  return <>
    <Drawer eyebrow="メモの内容" title={memo.title} onClose={onClose}><div className="stack">
      <p className="meta mb-0">{dayLabel(memoDateKey(memo))}</p>
      <p>{memo.body}</p>
      <div><h3>タグ</h3><div className="people">{memo.tags.map((tag) => <span className="person-chip" key={tag}>#{tag}</span>)}</div></div>
      <p className="small muted mb-0"><LockIcon width="14" aria-hidden="true"/> 共有範囲：{audienceText('memo', memo.visibility, (id) => memberName(snapshot, id))}</p>
      {memo.place && <section>
        <h3>{ja.place.legend}</h3>
        <PlaceSummary place={memo.place}/>
        <a data-control-id={`notes.place.open.${memo.id}`} className="button mt-1" href={`/places/${keyOfPlace(memo.place)}`} data-link><MapPinIcon width="17"/>この場所の記録を見る</a>
        {memo.place.provenance && <PlaceAttributionLink where="memo"/>}
      </section>}
      <MemoAttachments memo={memo} canAttach={canAttach} queue={queue}/>
      <MemoOcr memo={memo} canEdit={canEdit}/>
      {(canEdit || canDelete) && <div className="grid two">
        {canEdit && <button data-control-id={`notes.edit.open.${memo.id}`} className="button" type="button" onClick={() => setEditing(true)}>内容を編集</button>}
        {canDelete && <button data-control-id={`notes.delete.open.${memo.id}`} className="button danger" type="button" onClick={() => setDeleting(true)}>メモを削除</button>}
      </div>}
    </div></Drawer>
    {editing && <Dialog title="メモを編集" description="保存に失敗した場合も、入力中の内容は残ります。" onClose={() => { if (!submitting) setEditing(false); }}>
      <MemoForm formId={memo.id} initial={memoToDraft(memo)} submitLabel={ja.actions.saveChanges} busyLabel={ja.actions.saving} busy={submitting} error={formError} onSubmit={(draft) => void update(draft)} onCancel={() => setEditing(false)}/>
    </Dialog>}
    {deleting && <Dialog title="メモを削除しますか" description={`「${memo.title}」を削除します。`} onClose={() => setDeleting(false)} actions={<>
      <button data-control-id={`notes.delete.cancel.${memo.id}`} className="button" type="button" onClick={() => setDeleting(false)}>{ja.actions.cancel}</button>
      <button data-control-id={`notes.delete.confirm.${memo.id}`} className="button danger" type="button" onClick={() => void remove()}>{ja.actions.delete}</button>
    </>}><p className="muted">添付ファイルも表示されなくなります。削除後7日間は元に戻せます。</p></Dialog>}
  </>;
}
