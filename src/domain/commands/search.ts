import { redactPlace } from '../../authz/policy';
import type { InsightPort, ResourcePort, SearchResult, SearchResultKind } from '../../data/gateway';
import { deriveInsights } from '../insights';
import { aggregatePlaces } from '../places';
import type { Id, Insight } from '../types';
import { canSeeAlbum } from './albums';
import { ok } from './context';
import type { CommandContext, SyncPort } from './context';

/**
 * 全体の検索の、種類ごとの上限（A17）。契約（contracts/family-hub.openapi.yaml の searchHousehold の x-limits-per-kind）と同じ値。
 * 結果はこの順に並べる。
 */
export const SEARCH_LIMITS = { event: 5, task: 5, memo: 5, expense: 5, place: 5, resource: 5, album: 5, albumItem: 10 } as const satisfies Record<SearchResultKind, number>;

/** 写真・動画を開く行き先。表示画面をその項目で開く。 */
export const albumItemDestination = (albumId: Id, itemId: Id) => `/albums/${encodeURIComponent(albumId)}?item=${encodeURIComponent(itemId)}`;

/** 撮影日の書き方。書かれた時差での日付（2026-09-20・2026/09/20・2026/9/20・2026年9月20日）で探せる。 */
export function captureDateForms(takenAt: string | undefined): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt ?? '');
  if (!match) return [];
  const [, year, month, day] = match;
  return [`${year}-${month}-${day}`, `${year}/${month}/${day}`, `${year}/${Number(month)}/${Number(day)}`, `${year}年${Number(month)}月${Number(day)}日`];
}

export function createSearchCommands({ project, a, viewer }: CommandContext): SyncPort<ResourcePort> {
  return {
    search(query) {
      const snapshot = project();
      const normalized = query.trim().toLowerCase();
      if (!normalized) return ok([]);
      const has = (...values: Array<string | undefined>) => values.some((value) => value?.toLowerCase().includes(normalized));
      const take = <T,>(kind: SearchResultKind, items: readonly T[], matches: (item: T) => boolean, present: (item: T) => Omit<SearchResult, 'kind'>): SearchResult[] => {
        const found: SearchResult[] = [];
        for (const item of items) {
          if (found.length >= SEARCH_LIMITS[kind]) break;
          if (matches(item)) found.push({ kind, ...present(item) });
        }
        return found;
      };
      // アルバムは一覧と同じ規則で見えるものだけ。場所は place.read がなければ照合の前に取り除く。
      const current = viewer();
      const albums = a.albums.filter((album) => !album.deletedAt && canSeeAlbum(current, album)).map((album) => redactPlace(album, current));
      const albumById = new Map(albums.map((album) => [album.id, album]));
      // 写真と動画は、準備ができていて、ごみ箱にないものだけ。
      const items = a.albumItems.filter((item) => item.status === 'ready' && !item.deletedAt && albumById.has(item.albumId));
      const results: SearchResult[] = [
        ...take('event', snapshot.events, (item) => has(item.title, item.location, item.note), (item) => ({ id: item.id, label: item.title, detail: item.location, destination: `/calendar/${item.id}` })),
        ...take('task', snapshot.todos, (item) => has(item.title, item.note), (item) => ({ id: item.id, label: item.title, destination: `/tasks/${item.id}` })),
        ...take('memo', snapshot.memos, (item) => has(item.title, item.body, item.ocrText, ...item.tags, item.place?.name), (item) => ({ id: item.id, label: item.title, detail: item.tags.join(' / ') || undefined, destination: `/notes/${item.id}` })),
        ...take('expense', snapshot.expenses, (item) => has(item.title, item.note, item.place?.name), (item) => ({ id: item.id, label: item.title, detail: item.place?.name, destination: `/budget/${item.id}` })),
        ...take('place', aggregatePlaces(snapshot.expenses, snapshot.memos), (item) => has(item.place.name, item.place.address), (item) => ({ id: item.key, label: item.place.name, detail: item.place.address, destination: `/places/${item.key}` })),
        ...take('resource', snapshot.resources, (item) => has(item.label), (item) => ({ id: item.id, label: item.label, destination: `/settings/resources#${item.id}` })),
        ...take('album', albums, (album) => has(album.title, album.description, album.place?.name), (album) => ({ id: album.id, label: album.title, detail: album.place?.name ?? album.description, destination: `/albums/${encodeURIComponent(album.id)}` })),
        ...take('albumItem', items, (item) => has(item.originalName, ...captureDateForms(item.takenAt)), (item) => ({ id: item.id, label: item.originalName, detail: [albumById.get(item.albumId)?.title, captureDateForms(item.takenAt)[3]].filter(Boolean).join(' · '), destination: albumItemDestination(item.albumId, item.id) })),
      ];
      return ok(results.map((result) => (result.detail ? result : { kind: result.kind, id: result.id, label: result.label, destination: result.destination })));
    },
  };
}

export function createInsightCommands({ project, requireCapability }: CommandContext): SyncPort<InsightPort> {
  return {
    list() {
      const guard = requireCapability<Insight[]>('insight.read'); if (guard) return guard;
      return ok(deriveInsights(project()));
    },
  };
}
