import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { ImageIcon, VideoIcon } from '../../design-system/icons';
import type { AlbumItem } from '../../domain/types';

/** 縮小画像。読めないときや、まだないときは形だけを示す。 */
export function ItemImage({ item }: { item: AlbumItem }) {
  const { gateway } = useApp();
  const [failed, setFailed] = useState(false);
  if (!item.hasThumbnail || failed) return <span className="album-placeholder">{item.kind === 'video' ? <VideoIcon/> : <ImageIcon/>}</span>;
  return <img className="album-image" src={gateway.albums.mediaUrl(item, 'thumbnail')} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}/>;
}
