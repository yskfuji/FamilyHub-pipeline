/**
 * PDF の添付をアプリの中で描く（A14-2）。pdf.js（pdfjs-dist）は、PDF を開いたときにだけ読み込む（最初の表示の JS に入れない）。
 *
 * - CSP（script-src 'self'、'wasm-unsafe-eval' なし）を変えずに動かす。WebAssembly は使わない（useWasm: false）。
 *   JPX・JBIG2・色の変換・PostScript の関数は、pdf.js の JavaScript の代わりの道で処理する。
 * - eval を使う道は閉じる（isEvalSupported: false）。pdf.js 6 にはこの設定も eval を使う道もないが、
 *   前の版へ戻したときにも閉じたままにするため、渡しておく（scripts/security-check.mjs が確かめる）。
 * - worker は Vite が同じオリジンへ出すファイル（?worker）。CMap と標準の書体も同じオリジンの /pdfjs/ から読む
 *   （vite.config.ts の pdfjsResources がビルドに写す）。外のオリジンには何も取りに行かない。
 * - スクリプトは動かさない（enableScripting はこの API にない。注釈の操作も描かない）。
 */
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { PDF_MAX_PAGES, documentOptions, safeLinkUrl } from './pdfOptions';

export interface PdfLink { url: string; rect: [number, number, number, number] }
export interface PdfPageView {
  number: number;
  /** 幅 1 のときの縦横（ポイント）。 */
  width: number;
  height: number;
  text: string;
  links: PdfLink[];
  render(canvas: HTMLCanvasElement, cssWidth: number): Promise<void>;
}
export interface PdfView { pageCount: number; pages: PdfPageView[]; close(): Promise<void> }

/** 同じオリジンの期限付きの URL から PDF を読み、ページごとの描き方と、文字・リンクを返す。 */
export async function openPdf(url: string, signal: AbortSignal): Promise<PdfView> {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`pdf ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const pdfjs = await import('pdfjs-dist');
  const port = new PdfWorker();
  const worker = new pdfjs.PDFWorker({ port: port as never });
  const task = pdfjs.getDocument({ ...documentOptions(data, window.location.origin), worker } as Parameters<typeof pdfjs.getDocument>[0]);
  const close = async () => { await task.destroy().catch(() => undefined); worker.destroy(); port.terminate(); };
  try {
    const document = await task.promise;
    const count = Math.min(document.numPages, PDF_MAX_PAGES);
    const pages: PdfPageView[] = [];
    for (let number = 1; number <= count; number += 1) {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ''}` : '')).join('').trim();
      const annotations = await page.getAnnotations({ intent: 'display' }) as Array<{ subtype?: string; url?: unknown; rect?: number[] }>;
      const links = annotations.flatMap((annotation) => {
        const target = annotation.subtype === 'Link' ? safeLinkUrl(annotation.url) : null;
        if (!target || !annotation.rect) return [];
        // 幅 1 のときの画面の座標（左上が原点）。2つの角を写して並べ直す。
        const [x1, y1] = base.convertToViewportPoint(annotation.rect[0], annotation.rect[1]) as [number, number];
        const [x2, y2] = base.convertToViewportPoint(annotation.rect[2], annotation.rect[3]) as [number, number];
        return [{ url: target, rect: [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)] as [number, number, number, number] }];
      });
      pages.push({
        number, width: base.width, height: base.height, text, links,
        async render(canvas, cssWidth) {
          const scale = cssWidth / base.width;
          const ratio = Math.min(window.devicePixelRatio || 1, 3);
          const viewport = page.getViewport({ scale: scale * ratio });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await page.render({ canvas, viewport }).promise;
        },
      });
    }
    return { pageCount: document.numPages, pages, close };
  } catch (error) {
    await close();
    throw error;
  }
}
