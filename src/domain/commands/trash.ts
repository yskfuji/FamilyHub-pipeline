import type { TrashPort } from '../../data/gateway';
import { authorizeVisibleResource, canDeleteResource, canSeeExpense } from '../../authz/policy';
import { RETENTION_DAYS } from '../restoreWindow';
import type { TrashItem } from '../types';
import { ok } from './context';
import type { CommandContext, SyncPort } from './context';

const RETENTION_MS = RETENTION_DAYS * 86_400_000;

export function createTrashCommands(c: CommandContext): SyncPort<TrashPort> {
  const { a, state, viewer, withinRestoreWindow } = c;
  return {
    list() {
      const me = viewer();
      const can = (capability: Parameters<typeof canDeleteResource>[1], stakeholders: string[]) => canDeleteResource(me, capability, stakeholders).allowed;
      const fresh = (deletedAt?: string): deletedAt is string => Boolean(deletedAt) && withinRestoreWindow(deletedAt);
      const items: TrashItem[] = [
        ...state.events.filter((item) => fresh(item.deletedAt) && can('event.delete', [item.ownerMembershipId, ...item.participantMembershipIds])).map((item) => ({ kind: 'event' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
        ...a.occurrenceDeletions.filter((item) => fresh(item.deletedAt)).filter((item) => { const series = state.events.find((event) => event.id === item.eventId && !event.deletedAt); return series && can('event.delete', [series.ownerMembershipId, ...series.participantMembershipIds]); }).map((item) => ({ kind: 'occurrence' as const, id: item.eventId, occurrenceDate: item.occurrenceDate, title: item.title, deletedAt: item.deletedAt })),
        ...state.todos.filter((item) => fresh(item.deletedAt) && can('task.delete', [item.creatorMembershipId, item.assigneeMembershipId])).map((item) => ({ kind: 'task' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
        ...state.memos.filter((item) => fresh(item.deletedAt) && can('memo.delete', [item.authorMembershipId])).map((item) => ({ kind: 'memo' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
        ...state.expenses.filter((item) => fresh(item.deletedAt) && can('expense.delete', [item.creatorMembershipId, item.payerMembershipId]) && canSeeExpense(me, item)).map((item) => ({ kind: 'expense' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
        ...a.albums.filter((item) => fresh(item.deletedAt) && can('album.delete', [item.creatorMembershipId]) && authorizeVisibleResource(me, 'album.read', item.visibility, [item.creatorMembershipId]).allowed).map((item) => ({ kind: 'album' as const, id: item.id, title: item.title, deletedAt: item.deletedAt! })),
        ...a.albumItems.filter((item) => fresh(item.deletedAt) && can('album.delete', [item.uploaderMembershipId])).map((item) => ({ kind: 'photo' as const, id: item.id, parentId: item.albumId, title: item.originalName, deletedAt: item.deletedAt! })),
      ];
      return ok(items.sort((x, y) => y.deletedAt.localeCompare(x.deletedAt)));
    },
  };
}

/** 削除から30日を過ぎた記録を取り除く。消したファイルの ID を返し、呼び出し側が実体を消す。 */
export function purgeExpired(a: CommandContext['a'], nowIso: string) {
  const expired = (deletedAt?: string) => Boolean(deletedAt) && Date.parse(nowIso) - Date.parse(deletedAt!) > RETENTION_MS;
  const { state } = a;
  const removedFiles = [
    ...a.albumItems.filter((item) => expired(item.deletedAt) || a.albums.some((album) => album.id === item.albumId && expired(album.deletedAt))).map((item) => item.id),
    ...state.memos.filter((memo) => expired(memo.deletedAt)).flatMap((memo) => memo.attachments.map((item) => item.id)),
  ];
  const removedAlbums = new Set(a.albums.filter((album) => expired(album.deletedAt)).map((album) => album.id));
  state.events = state.events.filter((item) => !expired(item.deletedAt));
  state.todos = state.todos.filter((item) => !expired(item.deletedAt));
  state.memos = state.memos.filter((item) => !expired(item.deletedAt));
  state.expenses = state.expenses.filter((item) => !expired(item.deletedAt));
  a.albums = a.albums.filter((item) => !removedAlbums.has(item.id));
  a.albumItems = a.albumItems.filter((item) => !expired(item.deletedAt) && !removedAlbums.has(item.albumId));
  a.occurrenceDeletions = a.occurrenceDeletions.filter((item) => !expired(item.deletedAt));
  for (const name of ['events', 'todos', 'memos', 'expenses'] as const) {
    for (const [id, value] of Object.entries(a.archives[name])) if (expired((value as { deletedAt?: string }).deletedAt) || !state[name].some((item) => item.id === id)) delete a.archives[name][id];
  }
  return removedFiles;
}
