import { useRef, useState } from 'react';
import { useApp, memberName } from '../../app/AppContext';
import { detailId, navigate, useCloseTo } from '../../app/router';
import { Dialog, Drawer, EmptyState, PageHeader, StatusBadge, formatDate } from '../../design-system/components';
import { EyeIcon, FileIcon, NoteIcon, ShieldIcon, UploadIcon } from '../../design-system/icons';

const tone = (status: string) => status === 'clean' ? 'success' : status === 'rejected' ? 'danger' : status === 'quarantined' ? 'attention' : 'neutral';

export function NotesPage({ path }: { path: string }) {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const activeId = detailId(path, '/notes');
  const active = snapshot.memos.find((memo) => memo.id === activeId);
  const close = useCloseTo('/notes');
  const filtered = snapshot.memos.filter((memo) => `${memo.title} ${memo.body} ${memo.ocrText}`.toLowerCase().includes(query.toLowerCase()));
  const upload = async (file?: File) => {
    if (!active || !file) return;
    const result = await gateway.memos.uploadAttachment(active.id, file);
    if (!result.ok) { announce(result.error.message); return; }
    await refresh(); announce('添付を隔離領域へ送りました。安全確認の完了まで開けません');
  };
  const create = async (form: HTMLFormElement) => {
    setFormError(''); const values = new FormData(form);
    const result = await gateway.memos.createMemo({ title: String(values.get('title') ?? ''), body: String(values.get('body') ?? ''), tags: String(values.get('tags') ?? '').split(/[,、]/).map((tag) => tag.trim()).filter(Boolean) });
    if (!result.ok) { setFormError(result.error.message); return; }
    await refresh(); setCreating(false); announce('メモを作成しました'); navigate(`/notes/${result.value.id}`);
  };
  return <div className="page"><PageHeader eyebrow="Notes & OCR" title="家族のメモ" description="紙のお知らせも、共有したい控えも。OCRの結果は原本と並べて確認できます。" action={<button className="button primary" type="button" onClick={() => setCreating(true)}><NoteIcon width="18"/>メモを作る</button>}/><div className="field" style={{ maxWidth: '32rem', marginBottom: '1.5rem' }}><label htmlFor="note-search">メモ内を検索</label><input id="note-search" className="input" type="search" placeholder="タイトル、本文、OCRテキスト" value={query} onChange={(event) => setQuery(event.target.value)}/></div>{filtered.length === 0 ? <EmptyState title="一致するメモはありません">検索語を短くするか、新しいメモを作成してください。</EmptyState> : <div className="grid three">{filtered.map((memo) => <a className="card" href={`/notes/${memo.id}`} data-link key={memo.id} style={{ color: 'var(--ink)', textDecoration: 'none' }}><div className="split"><NoteIcon width="24"/><span className="meta">{formatDate(memo.updatedAt)}</span></div><h2>{memo.title}</h2><p className="muted">{memo.body}</p><div className="split"><span className="meta">{memberName(snapshot,memo.authorMembershipId)} · {memo.tags.join(' / ')}</span>{memo.attachments.length > 0 && <StatusBadge tone={tone(memo.attachments[0].status)}>{memo.attachments.length}添付</StatusBadge>}</div></a>)}</div>}
    {active && <Drawer eyebrow="Memo detail" title={active.title} onClose={close}><div className="stack"><p>{active.body}</p><div><h3>タグ</h3><div className="people">{active.tags.map((tag) => <span className="person-chip" key={tag}>#{tag}</span>)}</div></div><section className="card flat"><div className="section-head"><h3>添付ファイル</h3><button className="button" type="button" onClick={() => input.current?.click()}><UploadIcon width="17"/>追加</button><input ref={input} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => void upload(event.target.files?.[0])}/></div>{active.attachments.length === 0 ? <p className="muted">添付はありません</p> : <ul className="list">{active.attachments.map((attachment) => <li className="list-row" key={attachment.id}><FileIcon width="23"/><div className="row-main"><strong>{attachment.originalName}</strong><span className="meta">{(attachment.byteSize / 1_000_000).toFixed(1)} MB · {attachment.statusMessage}</span></div><StatusBadge tone={tone(attachment.status)}>{attachment.status === 'clean' ? '検査済み' : attachment.status === 'quarantined' ? '隔離中' : attachment.status}</StatusBadge></li>)}</ul>}<div className="callout info mt-1"><ShieldIcon/><div><strong>サーバー側の安全確認が必要です</strong><p className="small muted mb-0">拡張子・MIME・signature・サイズ・ランダム保存名・webroot外保存・ウイルス検査・世帯認可は、HTMLだけでは保証できません。</p></div></div></section>{active.ocrText && <section><div className="section-head"><h3><EyeIcon width="18"/> OCRテキスト</h3><StatusBadge>要原本確認</StatusBadge></div><div className="card flat"><p>{active.ocrText}</p><p className="small muted mb-0">認識結果には誤りがありえます。重要な日時や金額は原本で確認してください。</p></div></section>}</div></Drawer>}
    {creating && <Dialog title="メモを作る" description="添付は作成後の詳細画面から安全確認へ送れます。" onClose={() => { setCreating(false); setFormError(''); }}><form className="stack" onSubmit={(event) => { event.preventDefault(); void create(event.currentTarget); }}><label className="field"><span>タイトル</span><input className="input" name="title" required maxLength={120}/></label><label className="field"><span>本文</span><textarea className="textarea" name="body" required maxLength={5000}/></label><label className="field"><span>タグ</span><input className="input" name="tags" placeholder="学校、今週"/><span className="field-help">読点またはカンマで区切ります（最大10件）</span></label>{formError && <p className="field-error" role="alert">{formError}</p>}<div className="dialog-actions"><button className="button" type="button" onClick={() => setCreating(false)}>キャンセル</button><button className="button primary" type="submit">作成する</button></div></form></Dialog>}
  </div>;
}
