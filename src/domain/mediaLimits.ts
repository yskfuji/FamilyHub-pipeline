/** アルバムの写真・動画の上限。画面の事前の確かめと、記録の規則（commands/albums.ts）が同じ値を使う。 */
export const MEDIA_LIMITS = { photoBytes: 100 * 1024 * 1024, videoBytes: 4 * 1024 * 1024 * 1024, albumQuotaBytes: 20 * 1024 * 1024 * 1024 } as const;
