import type { AlbumItem } from '../../domain/types';

const dateTime = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Tokyo' });

export const formatItemDate = (value: string) => dateTime.format(new Date(value));
export const itemKindLabel = (item: Pick<AlbumItem, 'kind'>) => (item.kind === 'video' ? '動画' : '写真');
