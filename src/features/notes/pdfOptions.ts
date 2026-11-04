/** PDF の表示（src/features/notes/pdfDocument.ts）の設定。pdf.js を読み込まずに試験できるよう分けておく。 */

export const PDF_RESOURCES = '/pdfjs/';
/** 一度に描くページの上限。多いページの PDF は、保存して開いてもらう。 */
export const PDF_MAX_PAGES = 30;

/** PDF の中のリンクで開いてよいのは http と https だけ（javascript: や file: は開かない）。 */
export function safeLinkUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** pdf.js の getDocument に渡す設定。同じオリジンの資源だけを使う。 */
export function documentOptions(data: Uint8Array, origin: string) {
  return {
    data,
    cMapUrl: new URL(`${PDF_RESOURCES}cmaps/`, origin).href,
    cMapPacked: true,
    standardFontDataUrl: new URL(`${PDF_RESOURCES}standard_fonts/`, origin).href,
    useWasm: false,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  } as const;
}

