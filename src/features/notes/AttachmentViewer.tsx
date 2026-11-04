import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { attachmentViewerCopy, ja } from '../../content/ja';
import { CloseIcon, DownloadIcon, FileIcon } from '../../design-system/icons';
import { formatFileSize } from '../../domain/memoAttachments';
import type { Attachment, Memo } from '../../domain/types';
import { MediaFrame } from '../albums/MediaViewer';
import type { PdfPageView, PdfView } from './pdfDocument';
import { viewerKindOf } from './attachmentKinds';
import { useSaveAttachment } from './attachmentSave';

type Link = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'failed'; message: string };

function Unsupported({ message, attachment, onSave }: { message: string; attachment: Attachment; onSave: () => void }) {
  return <div className="media-panel" role="status">
    <FileIcon width="32" aria-hidden="true"/>
    <p className="media-panel-name file-name">{attachment.originalName}<span className="meta">{formatFileSize(attachment.byteSize)}</span></p>
    <p>{message}</p>
    <button data-control-id={`notes.attachment.viewer.save-open.${attachment.id}`} className="button primary" type="button" onClick={onSave}><DownloadIcon width="18"/>{attachmentViewerCopy.saveAndOpen}</button>
  </div>;
}

/** 1ページ。canvas に描き、文字は読み上げ用に、リンクは同じ位置のリンクとして重ねる。 */
function PdfPage({ page, total, width }: { page: PdfPageView; total: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (!canvas.current || width <= 0) return;
    let active = true;
    void page.render(canvas.current, width).then(() => { if (active) setDrawn(true); }, () => undefined);
    return () => { active = false; };
  }, [page, width]);
  const height = width * (page.height / page.width);
  return <figure className="pdf-page" data-page={page.number} data-drawn={drawn ? 'true' : undefined} style={{ width, height }} aria-label={attachmentViewerCopy.page(page.number, total)}>
    <canvas ref={canvas} className="pdf-canvas" aria-hidden="true"/>
    {page.links.map((link, index) => <a data-control-id={`notes.attachment.viewer.pdf-link.${page.number}.${index}`} key={`${link.url}-${index}`} className="pdf-link" href={link.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={attachmentViewerCopy.link(link.url)}
      style={{ left: `${(link.rect[0] / page.width) * 100}%`, top: `${(link.rect[1] / page.height) * 100}%`, width: `${(link.rect[2] / page.width) * 100}%`, height: `${(link.rect[3] / page.height) * 100}%` }}/>)}
    {page.text && <figcaption className="sr-only">{attachmentViewerCopy.pageText(page.number)}：{page.text}</figcaption>}
  </figure>;
}

function PdfDocument({ url, attachment, onSave }: { url: string; attachment: Attachment; onSave: () => void }) {
  const [view, setView] = useState<{ status: 'loading' } | { status: 'ready'; doc: PdfView } | { status: 'failed' }>({ status: 'loading' });
  const [width, setWidth] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let opened: PdfView | null = null;
    void import('./pdfDocument').then(({ openPdf }) => openPdf(url, controller.signal)).then((doc) => {
      if (controller.signal.aborted) { void doc.close(); return; }
      opened = doc;
      setView({ status: 'ready', doc });
    }, () => { if (!controller.signal.aborted) setView({ status: 'failed' }); });
    return () => { controller.abort(); void opened?.close(); };
  }, [url]);
  // ページは表示の幅に合わせて描く（幅が変わったら描き直す）。
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.min(Math.floor(entry.contentRect.width), 960)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={stage} className="pdf-document" data-pdf-state={view.status}>
    {view.status === 'loading' && <p className="media-loading" role="status">{attachmentViewerCopy.loading}</p>}
    {view.status === 'failed' && <Unsupported message={attachmentViewerCopy.pdfFailed} attachment={attachment} onSave={onSave}/>}
    {view.status === 'ready' && <>
      {view.doc.pages.map((page) => <PdfPage key={page.number} page={page} total={view.doc.pageCount} width={width}/>)}
      {view.doc.pageCount > view.doc.pages.length && <p className="media-panel small">{attachmentViewerCopy.tooMany(view.doc.pages.length, view.doc.pageCount)}</p>}
    </>}
  </div>;
}

/**
 * メモの添付をアプリの中で開く（A14）。画像と mp4 はアルバムと同じ表示の枠で、PDF は pdf.js で描く。
 * そのほかの形式（QuickTime など）と再生できない動画は、「保存して開く」を出す。閉じると「開く」のボタンへ焦点を戻す。
 */
export default function AttachmentViewer({ memo, attachment, onClose }: { memo: Memo; attachment: Attachment; onClose: () => void }) {
  const { gateway } = useApp();
  const kind = viewerKindOf(attachment.mimeType);
  const [link, setLink] = useState<Link>(kind === 'other' ? { status: 'failed', message: attachmentViewerCopy.unsupported } : { status: 'loading' });
  const [failed, setFailed] = useState(false);
  const save = useSaveAttachment(memo, attachment);
  useEffect(() => {
    if (kind === 'other') return;
    let active = true;
    void gateway.memos.getAttachmentLink(memo.id, attachment.id, 'inline').then((result) => {
      if (active) setLink(result.ok ? { status: 'ready', url: result.value.url } : { status: 'failed', message: result.error.message });
    });
    return () => { active = false; };
  }, [gateway, memo.id, attachment.id, kind]);

  const body = link.status === 'loading' ? <p className="media-loading" role="status">{attachmentViewerCopy.loading}</p>
    : link.status === 'failed' ? <Unsupported message={link.message} attachment={attachment} onSave={() => void save()}/>
      : kind === 'image' ? (failed ? <Unsupported message={attachmentViewerCopy.imageFailed} attachment={attachment} onSave={() => void save()}/> : <img className="media-full" src={link.url} alt={attachment.originalName} onError={() => setFailed(true)}/>)
        : kind === 'video' ? (failed ? <Unsupported message={attachmentViewerCopy.videoFailed} attachment={attachment} onSave={() => void save()}/> : <video className="media-full" src={link.url} controls playsInline preload="metadata" aria-label={attachment.originalName} onError={() => setFailed(true)}/>)
          : <PdfDocument url={link.url} attachment={attachment} onSave={() => void save()}/>;

  return <MediaFrame label={attachmentViewerCopy.label(attachment.originalName)} onEscape={onClose} stageClassName={kind === 'pdf' && link.status === 'ready' ? 'pdf-stage' : undefined}
    closeButton={<button data-control-id="notes.attachment.viewer.close" data-autofocus className="icon-button" type="button" aria-label={ja.actions.close} onClick={onClose}><CloseIcon/></button>}
    title={<div className="media-title"><p className="attachment-name file-name">{attachment.originalName}</p></div>}
    actions={<button data-control-id="notes.attachment.viewer.save" className="button media-save" type="button" aria-label={attachmentViewerCopy.saveLabel(attachment.originalName)} onClick={() => void save()}><DownloadIcon width="18"/>{attachmentViewerCopy.save}</button>}>
    {body}
  </MediaFrame>;
}
