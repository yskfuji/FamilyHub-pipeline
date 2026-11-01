/** 添付の上限。規則（commands/memos.ts）と同じ値で、送る前に理由を示すために使う。 */
export const ATTACHMENT_DOCUMENT_MAX_BYTES = 10_000_000;
export const ATTACHMENT_VIDEO_MAX_BYTES = 120_000_000;

const inMegabytes = (bytes: number) => `${bytes / 1_000_000}MB`;
/** 添付できるファイルの説明。 */
export const attachmentLimitsText = `PDF・JPEG・PNGは${inMegabytes(ATTACHMENT_DOCUMENT_MAX_BYTES)}まで、MP4は${inMegabytes(ATTACHMENT_VIDEO_MAX_BYTES)}まで添付できます。保存できるのは家族全体で1GBまでです。`;

/** ファイルを選ぶ欄の指定。 */
export const attachmentAccept = '.pdf,.jpg,.jpeg,.png,.mp4';

const typeByExtension: Readonly<Record<string, string>> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4' };
const allowedTypes = new Set(Object.values(typeByExtension));

/** ブラウザが種類を渡さないことがあるので、そのときは拡張子で判断する。 */
const attachmentType = (file: Pick<File, 'name' | 'type'>) => file.type || (typeByExtension[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '');

/** 送っても受け付けられないファイルの理由。問題がなければ null。 */
export function attachmentProblem(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const type = attachmentType(file);
  if (!allowedTypes.has(type)) return '添付できるのはPDF・JPEG・PNG・MP4です。';
  if (type === 'video/mp4') return file.size > ATTACHMENT_VIDEO_MAX_BYTES ? `動画は${inMegabytes(ATTACHMENT_VIDEO_MAX_BYTES)}以内にしてください。` : null;
  return file.size > ATTACHMENT_DOCUMENT_MAX_BYTES ? `PDFと画像は${inMegabytes(ATTACHMENT_DOCUMENT_MAX_BYTES)}以内にしてください。` : null;
}

export const formatFileSize = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);
