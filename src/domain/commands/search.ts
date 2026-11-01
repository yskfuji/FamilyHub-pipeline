import type { InsightPort, ResourcePort } from '../../data/gateway';
import { deriveInsights } from '../insights';
import { aggregatePlaces } from '../places';
import type { Id, Insight } from '../types';
import { ok } from './context';
import type { CommandContext, SyncPort } from './context';

export function createSearchCommands({ project }: CommandContext): SyncPort<ResourcePort> {
  return {
    search(query) {
      const snapshot = project();
      const normalized = query.trim().toLowerCase();
      if (!normalized) return ok([]);
      const has = (...values: Array<string | undefined>) => values.some((value) => value?.toLowerCase().includes(normalized));
      const results: Array<{ kind: 'event' | 'task' | 'memo' | 'expense' | 'place' | 'resource'; id: Id; label: string; detail?: string; destination: string }> = [
        ...snapshot.events.filter((item) => has(item.title, item.location, item.note)).map((item) => ({ kind: 'event' as const, id: item.id, label: item.title, detail: item.location, destination: `/calendar/${item.id}` })),
        ...snapshot.todos.filter((item) => has(item.title, item.note)).map((item) => ({ kind: 'task' as const, id: item.id, label: item.title, destination: `/tasks/${item.id}` })),
        ...snapshot.memos.filter((item) => has(item.title, item.body, item.ocrText, ...item.tags, item.place?.name)).map((item) => ({ kind: 'memo' as const, id: item.id, label: item.title, detail: item.tags.join(' / ') || undefined, destination: `/notes/${item.id}` })),
        ...snapshot.expenses.filter((item) => has(item.title, item.note, item.place?.name)).map((item) => ({ kind: 'expense' as const, id: item.id, label: item.title, detail: item.place?.name, destination: `/budget/${item.id}` })),
        ...aggregatePlaces(snapshot.expenses, snapshot.memos).filter((item) => has(item.place.name, item.place.address)).map((item) => ({ kind: 'place' as const, id: item.key, label: item.place.name, detail: item.place.address, destination: `/places/${item.key}` })),
        ...snapshot.resources.filter((item) => has(item.label)).map((item) => ({ kind: 'resource' as const, id: item.id, label: item.label, destination: `/settings/resources#${item.id}` })),
      ];
      return ok(results.slice(0, 12));
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
