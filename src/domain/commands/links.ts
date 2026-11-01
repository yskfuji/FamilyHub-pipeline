import type { LinkPort } from '../../data/gateway';
import type { ItemLink, LinkedItemRef } from '../types';
import { fail, invalid, missing, ok } from './context';
import type { CommandContext, SyncPort } from './context';

const same = (a: LinkedItemRef, b: LinkedItemRef) => a.kind === b.kind && a.id === b.id;

export function createLinkCommands(c: CommandContext): SyncPort<LinkPort> {
  const { state, nextId, now, viewer, requireCapability, project } = c;
  const visible = (item: LinkedItemRef) => {
    const snapshot = project();
    if (item.kind === 'event') return snapshot.events.some((entry) => entry.id === item.id);
    if (item.kind === 'task') return snapshot.todos.some((entry) => entry.id === item.id);
    if (item.kind === 'memo') return snapshot.memos.some((entry) => entry.id === item.id);
    return snapshot.expenses.some((entry) => entry.id === item.id);
  };
  return {
    createLink(from, to) {
      const guard = requireCapability<ItemLink>('link.manage'); if (guard) return guard;
      if (same(from, to)) return invalid([{ message: '同じ記録どうしは関連づけられません。' }]);
      // 見えない記録には関連づけられない。存在するかどうかも知らせない。
      if (!visible(from) || !visible(to)) return missing('記録');
      if (state.links.some((link) => (same(link.from, from) && same(link.to, to)) || (same(link.from, to) && same(link.to, from)))) return fail({ code: 'CONFLICT', message: 'すでに関連づけられています。', retryable: false });
      const link: ItemLink = { id: nextId('link'), householdId: state.household.id, from, to, createdByMembershipId: viewer().membershipId, createdAt: now() };
      state.links = [...state.links, link];
      return ok(structuredClone(link));
    },
    deleteLink(id) {
      const guard = requireCapability<void>('link.manage'); if (guard) return guard;
      if (!project().links.some((link) => link.id === id)) return missing('関連づけ');
      state.links = state.links.filter((link) => link.id !== id);
      return ok(undefined);
    },
  };
}
