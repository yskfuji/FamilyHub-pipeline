/**
 * 添付をアプリの中でどう開くか（A14）。API が inline で配るのと同じ種類（server/http/routes/media.ts の INLINE_TYPES）だけを表示し、
 * ほかは「保存して開く」にする。QuickTime（video/quicktime）は再生できない端末があるので表示しない。
 */
export type ViewerKind = 'image' | 'video' | 'pdf' | 'other';
const kinds: Readonly<Record<string, ViewerKind>> = { 'image/jpeg': 'image', 'image/png': 'image', 'video/mp4': 'video', 'application/pdf': 'pdf' };
export const viewerKindOf = (mimeType: string): ViewerKind => kinds[mimeType] ?? 'other';
