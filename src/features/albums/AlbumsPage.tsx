import { useState } from 'react';
import { detailId } from '../../app/router';
import type { Album } from '../../domain/types';
import { AlbumDetail } from './AlbumDetail';
import { AlbumList } from './AlbumList';
import { useAlbumUploads } from './useAlbumUploads';

export function AlbumsPage({ path }: { path: string }) {
  const activeId = detailId(path, '/albums');
  const uploads = useAlbumUploads();
  const [deleted, setDeleted] = useState<Album | null>(null);
  if (activeId) return <AlbumDetail key={activeId} albumId={activeId} uploads={uploads} onDeleted={setDeleted}/>;
  return <AlbumList uploads={uploads} deleted={deleted} onRestored={() => setDeleted(null)}/>;
}
