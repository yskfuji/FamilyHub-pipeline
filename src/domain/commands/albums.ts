import { authorize, authorizeVisibleResource, canDeleteResource, canMutateOwnedResource, redactPlace } from '../../authz/policy';
import { albumInputSchema, albumUpdateSchema } from '../schemas';
import type { Album, AlbumItem, AlbumSummary, Id, Result } from '../types';
import { applyPatch, conflict, denied, fail, invalid, missing, ok } from './context';
import type { CommandContext } from './context';

export const MEDIA_LIMITS = { photoBytes: 100 * 1024 * 1024, videoBytes: 4 * 1024 * 1024 * 1024, albumQuotaBytes: 20 * 1024 * 1024 * 1024 } as const;

export interface NewItem { kind: 'photo' | 'video'; originalName: string; mimeType: string; byteSize: number; keepLocation: boolean }

export function createAlbumCommands(c: CommandContext) {
  const { a, state, nextId, now, viewer, offlineFailure, requireCapability, withinRestoreWindow, defaultVisibility, resolveVisibility, placeWriteGuard } = c;
  const seen = (album: Album) => authorizeVisibleResource(viewer(), 'album.read', album.visibility, [album.creatorMembershipId]).allowed;
  const found = (id: Id) => a.albums.find((item) => item.id === id && !item.deletedAt);
  const clean = (album: Album) => redactPlace(structuredClone(album), viewer());
  const items = (albumId: Id) => a.albumItems.filter((item) => item.albumId === albumId && !item.deletedAt).sort((x, y) => x.position - y.position);
  const usedBytes = () => a.albumItems.filter((item) => item.status !== 'rejected').reduce((sum, item) => sum + item.byteSize, 0);
  return {
    listAlbums(): Result<AlbumSummary[]> {
      const guard = requireCapability<AlbumSummary[]>('album.read'); if (guard) return guard;
      return ok(a.albums.filter((album) => !album.deletedAt && seen(album)).map((album) => ({ ...clean(album), itemCount: items(album.id).filter((item) => item.status === 'ready').length })));
    },
    getAlbum(id: Id): Result<{ album: Album; items: AlbumItem[] }> {
      const album = found(id);
      if (!album || !seen(album)) return missing('アルバム');
      return ok({ album: clean(album), items: structuredClone(items(id)) });
    },
    createAlbum(input: unknown): Result<Album> {
      const guard = requireCapability<Album>('album.create'); if (guard) return guard;
      const placeGuard = placeWriteGuard<Album>((input as { place?: unknown }).place ?? undefined); if (placeGuard) return placeGuard;
      const network = offlineFailure<Album>(); if (network) return network;
      const parsed = albumInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const { visibility: requested, place, bgmPreset, ...fields } = parsed.data;
      const visibility = requested ? resolveVisibility(requested, viewer().membershipId) : ok(defaultVisibility());
      if (!visibility.ok) return visibility;
      const album: Album = { id: nextId('album'), householdId: state.household.id, ...fields, ...(place ? { place } : {}), ...(bgmPreset ? { bgmPreset } : {}), creatorMembershipId: viewer().membershipId, visibility: visibility.value, createdAt: now(), version: 1 };
      a.albums = [album, ...a.albums];
      return ok(clean(album));
    },
    updateAlbum(id: Id, input: unknown, expectedVersion: number): Result<Album> {
      const album = found(id);
      if (!album || !seen(album)) return missing('アルバム');
      const decision = canMutateOwnedResource(viewer(), 'album.update', album.creatorMembershipId); if (!decision.allowed) return denied(decision);
      const placeGuard = placeWriteGuard<Album>((input as { place?: unknown }).place ?? undefined); if (placeGuard) return placeGuard;
      const network = offlineFailure<Album>(); if (network) return network;
      if (album.version !== expectedVersion) return conflict('アルバム');
      const parsed = albumUpdateSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const { visibility: requested, ...fields } = parsed.data;
      if (fields.coverItemId && !items(id).some((item) => item.id === fields.coverItemId)) return invalid([{ message: '表紙にする写真を確認してください。' }]);
      const visibility = requested ? resolveVisibility(requested, album.creatorMembershipId) : null;
      if (visibility && !visibility.ok) return visibility;
      applyPatch(album, fields);
      if (visibility?.ok) album.visibility = visibility.value;
      album.version += 1;
      return ok(clean(album));
    },
    deleteAlbum(id: Id, expectedVersion: number): Result<void> {
      const album = found(id);
      if (!album || !seen(album)) return missing('アルバム');
      const decision = canDeleteResource(viewer(), 'album.delete', [album.creatorMembershipId]); if (!decision.allowed) return denied(decision);
      if (album.version !== expectedVersion) return conflict('アルバム');
      album.deletedAt = now(); album.version += 1;
      return ok(undefined);
    },
    restoreAlbum(id: Id): Result<Album> {
      const album = a.albums.find((item) => item.id === id);
      if (!album?.deletedAt || !seen(album)) return missing('アルバム');
      const decision = canDeleteResource(viewer(), 'album.delete', [album.creatorMembershipId]); if (!decision.allowed) return denied(decision);
      if (!withinRestoreWindow(album.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      delete album.deletedAt; album.version += 1;
      return ok(clean(album));
    },
    reorderItems(albumId: Id, itemIds: Id[], expectedVersion: number): Result<Album> {
      const album = found(albumId);
      if (!album || !seen(album)) return missing('アルバム');
      const decision = canMutateOwnedResource(viewer(), 'album.update', album.creatorMembershipId); if (!decision.allowed) return denied(decision);
      if (album.version !== expectedVersion) return conflict('アルバム');
      const current = items(albumId);
      if (itemIds.length !== current.length || new Set(itemIds).size !== current.length || current.some((item) => !itemIds.includes(item.id))) return invalid([{ message: '並び順を確認してください。' }]);
      for (const item of current) item.position = itemIds.indexOf(item.id);
      album.version += 1;
      return ok(clean(album));
    },
    deleteItem(albumId: Id, itemId: Id): Result<void> {
      const album = found(albumId);
      if (!album || !seen(album)) return missing('アルバム');
      const item = items(albumId).find((entry) => entry.id === itemId);
      if (!item) return missing('写真');
      const decision = canDeleteResource(viewer(), 'album.delete', [album.creatorMembershipId, item.uploaderMembershipId]); if (!decision.allowed) return denied(decision);
      item.deletedAt = now();
      return ok(undefined);
    },
    restoreItem(albumId: Id, itemId: Id): Result<AlbumItem> {
      const album = found(albumId);
      if (!album || !seen(album)) return missing('アルバム');
      const item = a.albumItems.find((entry) => entry.id === itemId && entry.albumId === albumId);
      if (!item?.deletedAt) return missing('写真');
      const decision = canDeleteResource(viewer(), 'album.delete', [album.creatorMembershipId, item.uploaderMembershipId]); if (!decision.allowed) return denied(decision);
      if (!withinRestoreWindow(item.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      delete item.deletedAt;
      return ok(structuredClone(item));
    },
    /** 受け付けた写真や動画の枠を作る。容量と大きさはここで確かめ、ファイルの処理は呼び出し側が行う。 */
    reserveItem(albumId: Id, file: NewItem): Result<AlbumItem> {
      const album = found(albumId);
      if (!album || !seen(album)) return missing('アルバム');
      const decision = canMutateOwnedResource(viewer(), 'album.update', album.creatorMembershipId);
      if (!decision.allowed && !authorize(viewer(), 'album.create').allowed) return denied(decision);
      const limit = file.kind === 'video' ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.photoBytes;
      if (file.byteSize <= 0 || file.byteSize > limit) return fail({ code: 'ATTACHMENT_REJECTED', message: file.kind === 'video' ? '動画は4GBまでです。' : '写真は100MBまでです。', retryable: false });
      if (usedBytes() + file.byteSize > MEDIA_LIMITS.albumQuotaBytes) return fail({ code: 'ATTACHMENT_REJECTED', message: 'アルバムの保存容量を超えます。不要な写真を削除してください。', retryable: false });
      const item: AlbumItem = { id: nextId('item'), albumId, householdId: state.household.id, kind: file.kind, originalName: file.originalName.slice(0, 200), mimeType: file.mimeType, byteSize: file.byteSize, status: 'uploading', locationKept: file.keepLocation, hasThumbnail: false, uploaderMembershipId: viewer().membershipId, position: items(albumId).length, createdAt: now() };
      a.albumItems = [...a.albumItems, item];
      return ok(structuredClone(item));
    },
  };
}
