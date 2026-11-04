import { Suspense, lazy, useMemo, useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { useMemberScope } from '../../app/useMemberScope';
import { detailId, navigate, useSearch, withQueryParam } from '../../app/router';
import { ja } from '../../content/ja';
import { DetailNotFound, Dialog, EmptyState, PageHeader, StatusBadge } from '../../design-system/components';
import { EmptyMemos } from '../../design-system/illustrations/EmptyMemos';
import { EmptySearch } from '../../design-system/illustrations/EmptySearch';
import { useContentWide } from '../../design-system/DetailSurface';
import { LockIcon, MapPinIcon, NoteIcon } from '../../design-system/icons';
import { dateKeyFromRfc3339 } from '../../domain/calendarDate';
import { memoDraftToCreateInput, newMemoDraft, type MemoAudience, type MemoDraft } from '../../domain/memoForm';
import { memoDateKey, memoSorts, parseMemoSort, sortMemos } from '../../domain/memoList';
import { defaultAudience } from '../../domain/visibilityForm';
import type { Attachment, Memo } from '../../domain/types';
import { dayLabel } from '../calendar/calendarLabels';
import { MemberScopeSelect, ScopeNote } from '../shared/MemberScopeSelect';
import { audienceText } from '../shared/visibilityText';
import { useAttachmentQueue } from './useAttachmentQueue';

/** メモの詳細と作成のフォームは、開いたときに読む。 */
const MemoDrawer = lazy(async () => ({ default: (await import('./MemoDrawer')).MemoDrawer }));
const MemoForm = lazy(async () => ({ default: (await import('./MemoForm')).MemoForm }));

const attachmentTone = (attachments: readonly Attachment[]) => (attachments.some((item) => item.status === 'rejected') ? 'danger' : attachments.some((item) => item.status !== 'clean') ? 'attention' : 'success');

export function NotesPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce, can, executeQueueable, privacy } = useApp();
  const [query, setQuery] = useState('');
  // 開いた URL にいる間だけ開く（確認で破棄して別の URL へ移ったときに残さない）。
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const creating = creatingOn === path;
  const setCreating = (value: boolean) => setCreatingOn(value ? path : null);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleted, setDeleted] = useState<Memo | null>(null);
  const queue = useAttachmentQueue();
  const search = useSearch();
  const sort = parseMemoSort(new URLSearchParams(search).get('sort'));
  const activeId = detailId(path, '/notes');
  const active = snapshot.memos.find((memo) => memo.id === activeId);
  const { memos: scoped, memberId } = useMemberScope();
  const wide = useContentWide();
  const memos = useMemo(() => {
    const words = query.trim().toLowerCase();
    return sortMemos(scoped.filter((memo) => [memo.title, memo.body, memo.ocrText ?? '', ...memo.tags, memo.place?.name ?? ''].join(' ').toLowerCase().includes(words)), sort);
  }, [scoped, query, sort]);

  /**
   * ファイルを選んでいるメモは、未送信の変更として保存しない（ファイルは保存できず、失われるため）。
   * 作った後の添付の失敗は待ち行列に残るので、メモを作り直さずに送り直せる。
   */
  const create = async (draft: MemoDraft, files: File[]) => {
    if (submitting) return;
    setFormError(''); setSubmitting(true);
    const input = memoDraftToCreateInput(draft);
    const outcome = files.length
      ? await gateway.memos.createMemo(input).then((result) => (result.ok ? { status: 'completed' as const, value: result.value } : { status: 'failed' as const, error: result.error }))
      : await executeQueueable({ operation: 'memo.create', summary: `メモ「${input.title}」を作成`, payload: { input } }, () => gateway.memos.createMemo(input));
    setSubmitting(false);
    if (outcome.status === 'failed') { setFormError(outcome.error.message); return; }
    if (outcome.status === 'queued') { setCreating(false); return; }
    await refresh();
    setCreating(false);
    announce('メモを作成しました');
    navigate(`/notes/${outcome.value.id}${search}`);
    if (files.length) queue.add(outcome.value.id, files);
  };
  const restore = async () => {
    if (!deleted) return;
    const result = await gateway.memos.restoreMemo(deleted.id);
    if (!result.ok) return announce(result.error.message);
    setDeleted(null);
    await refresh();
    announce(`「${result.value.title}」を元に戻しました`);
  };

  return <div className="page">
    <PageHeader eyebrow="メモ" title="家族のメモ" description="家族で共有する連絡や控えをまとめます。文字認識の結果は、元のファイルと照らし合わせて確認できます。" action={<div className="page-head-actions"><MemberScopeSelect/>{can('memo.create') && <button data-control-id="notes.create.open" className="button primary" type="button" onClick={() => { setFormError(''); setCreating(true); }}><NoteIcon width="18"/>メモを追加</button>}</div>}/>
    {activeId && !active && <DetailNotFound what="メモ" feature="notes" backHref={`/notes${search}`}/>}
    {deleted && <div className="callout info" role="status"><NoteIcon/><div><strong>「{deleted.title}」を削除しました</strong><p className="small muted mb-0">7日以内は元に戻せます。</p></div><button data-control-id="notes.restore" className="button" type="button" onClick={() => void restore()}>{ja.actions.restore}</button></div>}
    <div className="detail-layout" data-pane={wide && active ? 'open' : undefined}><div className="detail-main">
    <div className="notes-toolbar">
      <div className="field"><label htmlFor="note-search">メモを検索</label><input data-control-id="notes.search" id="note-search" className="input" type="search" aria-describedby="note-search-help" value={query} onChange={(event) => setQuery(event.target.value)}/><span className="field-help" id="note-search-help">タイトル、本文、タグ、文字認識の結果、記録した場所の名前から検索します。</span></div>
      <div className="segmented" role="group" aria-label="メモの並び順">{memoSorts.map((value) => <button data-control-id={`notes.sort.${value}`} key={value} type="button" aria-pressed={sort === value} onClick={() => navigate(withQueryParam('sort', value === 'newest' ? null : value), true, true)}>{ja.memoSort[value]}</button>)}</div>
    </div>
    {memos.length === 0
      ? scoped.length === 0 && !memberId
        ? <EmptyState title="まだメモはありません" illustration={<EmptyMemos/>} action={can('memo.create') ? <button data-control-id="notes.empty.create" className="button primary" type="button" onClick={() => { setFormError(''); setCreating(true); }}>最初のメモを書く</button> : undefined}>{can('memo.create') ? '学校からの連絡や控えをメモにすると、家族で同じものを確認できます。' : '共有されたメモが追加されると、ここに表示します。'}</EmptyState>
        : <EmptyState title="条件に合うメモはありません" illustration={memberId ? <EmptyMemos/> : <EmptySearch/>}>{memberId ? <ScopeNote/> : '検索語を短くするか、新しいメモを追加してください。'}</EmptyState>
      : <div className="grid three">{memos.map((memo) => <a data-control-id={`notes.open.${memo.id}`} className="card memo-card" href={`/notes/${memo.id}${search}`} data-link data-keep-scroll key={memo.id}>
        <div className="split"><NoteIcon width="24"/><span className="meta">{dayLabel(memoDateKey(memo))}</span></div>
        <h2 data-transition-title>{memo.title}</h2>
        <p className="muted">{memo.body}</p>
        {memo.place && <span className="place-chip"><MapPinIcon width="14"/>{memo.place.name}</span>}
        <div className="split">
          <span className="meta">{memberName(snapshot, memo.authorMembershipId)} · {memo.tags.join(' / ')} · <LockIcon width="12" aria-hidden="true"/> {audienceText('memo', memo.visibility, (id) => memberName(snapshot, id))}</span>
          {memo.attachments.length > 0 && <StatusBadge tone={attachmentTone(memo.attachments)}>添付 {memo.attachments.length}件</StatusBadge>}
        </div>
      </a>)}</div>}
    </div>
    {active && <Suspense fallback={null}><MemoDrawer key={active.id} memo={active} queue={queue} onClose={() => navigate(`/notes${search}`, false, true)} onDeleted={setDeleted}/></Suspense>}
    </div>
    {creating && <Suspense fallback={null}><Dialog title="メモを作る" description="ファイルも一緒に追加できます。追加したファイルは、確認が終わるまで開けません。" onClose={() => { if (!submitting) setCreating(false); }}>
      <MemoForm formId="new" initial={newMemoDraft(dateKeyFromRfc3339(snapshot.context.asOf), defaultAudience(snapshot.viewer.role, 'memo', privacy?.defaultAudience) as MemoAudience)} submitLabel="作成する" busyLabel="作成中…" busy={submitting} error={formError} offerFiles onSubmit={(draft, files) => void create(draft, files)} onCancel={() => setCreating(false)}/>
    </Dialog></Suspense>}
  </div>;
}
