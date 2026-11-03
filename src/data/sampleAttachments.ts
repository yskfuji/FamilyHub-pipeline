import clip from './samples/sample-clip.mp4?url&no-inline';
import diagram from './samples/sample-diagram.png?url&no-inline';
import notice from './samples/sample-notice.pdf?url&no-inline';
import photo from './samples/sample-photo.jpg?url&no-inline';

/**
 * 確認用データ（モック）の添付の見本（A14-4）。種類ごとに、同じオリジンから配る見本のファイルの URL を返す。
 * ファイルは scripts/build-sample-attachments.mjs で作り、モックのビルドだけが読む（dist-http には入らない。audit:security が確かめる）。
 * 同じオリジンの URL にするのは、PDF の表示（pdf.js）が connect-src 'self' のまま読めるようにするため（blob: は connect-src で許していない）。
 */
export const sampleAttachmentUrls: Readonly<Record<string, string>> = {
  'image/jpeg': photo,
  'image/png': diagram,
  'application/pdf': notice,
  'video/mp4': clip,
};
