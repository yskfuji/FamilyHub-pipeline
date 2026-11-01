import type { EventPort } from '../../data/gateway';
import { authorizeVisibleResource, canDeleteResource, canMutateOwnedResource } from '../../authz/policy';
import { addDateKeyDays, dateKeyFromRfc3339 } from '../calendarDate';
import { isOccurrence, occurrenceStartsAt, remainderRule, withUntil } from '../recurrence';
import { eventFieldsSchema, eventUpdateSchema, isEventTimeRangeValid } from '../schemas';
import type { CalendarEvent, IsoDate } from '../types';
import { applyPatch, archive, conflict, denied, fail, invalid, missing, ok } from './context';
import type { CommandContext, SyncPort } from './context';

export function createEventCommands(c: CommandContext): SyncPort<EventPort> {
  const { a, state, nextId, now, viewer, requireCapability, offlineFailure, permissionConflict, withinRestoreWindow, defaultVisibility, foreignMember, foreignLabel, resolveVisibility } = c;
  /** 回の長さは元の予定の日数のまま保つ（複数日の予定の回がずれないように）。 */
  const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  const stakeholders = (item: CalendarEvent) => [item.ownerMembershipId, ...item.participantMembershipIds];
  const seen = (item: CalendarEvent) => authorizeVisibleResource(viewer(), 'event.read', item.visibility, [item.ownerMembershipId, ...item.participantMembershipIds]).allowed;
  return {
    createEvent(input, context) {
      const revision = permissionConflict<CalendarEvent>(context); if (revision) return revision;
      const guard = requireCapability<CalendarEvent>('event.create'); if (guard) return guard;
      const network = offlineFailure<CalendarEvent>(); if (network) return network;
      const parsed = eventFieldsSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const outsider = foreignMember<CalendarEvent>(parsed.data.participantMembershipIds); if (outsider) return outsider;
      if (!isEventTimeRangeValid(parsed.data.startsAt, parsed.data.endsAt)) return invalid([{ message: '終了日時は開始日時より後にしてください。' }]);
      const label = foreignLabel<CalendarEvent>(parsed.data.colorLabelId); if (label) return label;
      const { visibility: requested, ...fields } = parsed.data;
      const visibility = requested ? resolveVisibility(requested, viewer().membershipId) : ok(defaultVisibility());
      if (!visibility.ok) return visibility;
      const event: CalendarEvent = {
        ...fields, recurrence: fields.recurrence as CalendarEvent['recurrence'],
        id: nextId('event'), householdId: state.household.id, ownerMembershipId: viewer().membershipId, version: 1, visibility: visibility.value,
      };
      state.events = [...state.events, event];
      return ok(structuredClone(event));
    },
    updateEvent(id, scope, input, expectedVersion, context, occurrenceDate) {
      const revision = permissionConflict<CalendarEvent>(context); if (revision) return revision;
      const target = state.events.find((event) => event.id === id && !event.deletedAt);
      if (!target || !seen(target)) return missing('予定');
      const decision = canMutateOwnedResource(viewer(), 'event.update', target.ownerMembershipId); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<CalendarEvent>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('予定');
      const parsed = eventUpdateSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const outsider = foreignMember<CalendarEvent>(parsed.data.participantMembershipIds ?? []); if (outsider) return outsider;
      const label = foreignLabel<CalendarEvent>(parsed.data.colorLabelId); if (label) return label;
      const { visibility: requested, ...fields } = parsed.data;
      const visibility = requested ? resolveVisibility(requested, target.visibility.creatorMembershipId) : null;
      if (visibility && !visibility.ok) return visibility;
      const changes = { ...fields, ...(visibility?.ok ? { visibility: visibility.value } : {}) };
      const seriesStart = dateKeyFromRfc3339(target.startsAt);
      const recurring = Boolean(target.recurrence) && scope !== 'series';
      if (recurring && (!occurrenceDate || !isOccurrence(seriesStart, target.recurrence!, occurrenceDate))) return invalid([{ message: '変更する回を確認してください。' }]);
      archive(a.archives.events, target.id, structuredClone(target));
      if (!recurring || (scope === 'future' && occurrenceDate === seriesStart)) {
        const next = structuredClone(target); applyPatch(next, changes);
        if (!isEventTimeRangeValid(next.startsAt, next.endsAt)) return invalid([{ message: '終了日時は開始日時より後にしてください。' }]);
        applyPatch(target, changes); target.version += 1;
        return ok(structuredClone(target));
      }
      const occurrence = occurrenceDate as IsoDate;
      const base: CalendarEvent = { ...structuredClone(target), startsAt: occurrenceStartsAt(target.startsAt, occurrence), endsAt: occurrenceStartsAt(target.endsAt, addDateKeyDays(occurrence, daysBetween(seriesStart, dateKeyFromRfc3339(target.endsAt))) as IsoDate) };
      const copy: CalendarEvent = { ...base, id: nextId('event'), version: 1 };
      applyPatch(copy, changes);
      if (!isEventTimeRangeValid(copy.startsAt, copy.endsAt)) return invalid([{ message: '終了日時は開始日時より後にしてください。' }]);
      if (scope === 'this') {
        delete copy.recurrence;
        target.recurrence = { ...target.recurrence!, exceptions: [...target.recurrence!.exceptions, occurrence] };
      } else {
        copy.recurrence = { ...target.recurrence!, rrule: remainderRule(seriesStart, target.recurrence!, occurrence), exceptions: target.recurrence!.exceptions.filter((date) => date >= occurrence) };
        target.recurrence = { ...target.recurrence!, rrule: withUntil(target.recurrence!.rrule, addDateKeyDays(occurrence, -1)), exceptions: target.recurrence!.exceptions.filter((date) => date < occurrence) };
      }
      target.version += 1;
      state.events = [...state.events, copy];
      return ok(structuredClone(copy));
    },
    deleteEvent(id, scope, expectedVersion, occurrenceDate) {
      const target = state.events.find((event) => event.id === id && !event.deletedAt);
      if (!target || !seen(target)) return missing('予定');
      const decision = canDeleteResource(viewer(), 'event.delete', stakeholders(target)); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<void>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('予定');
      const seriesStart = dateKeyFromRfc3339(target.startsAt);
      const partial = Boolean(target.recurrence) && scope !== 'series' && !(scope === 'future' && occurrenceDate === seriesStart);
      if (partial && (!occurrenceDate || !isOccurrence(seriesStart, target.recurrence!, occurrenceDate))) return invalid([{ message: '削除する回を確認してください。' }]);
      archive(a.archives.events, id, structuredClone(target));
      if (!partial) target.deletedAt = now();
      else if (scope === 'this') {
        target.recurrence = { ...target.recurrence!, exceptions: [...target.recurrence!.exceptions, occurrenceDate as IsoDate] };
        a.occurrenceDeletions.push({ eventId: id, occurrenceDate: occurrenceDate as IsoDate, deletedAt: now(), title: target.title });
      }
      else target.recurrence = { ...target.recurrence!, rrule: withUntil(target.recurrence!.rrule, addDateKeyDays(occurrenceDate!, -1)) };
      target.version += 1;
      return ok(undefined);
    },
    restoreEvent(id, occurrenceDate) {
      if (occurrenceDate) {
        const series = state.events.find((item) => item.id === id && !item.deletedAt);
        const record = a.occurrenceDeletions.find((item) => item.eventId === id && item.occurrenceDate === occurrenceDate);
        if (!series?.recurrence || !seen(series) || !record) return missing('予定');
        const allowed = canDeleteResource(viewer(), 'event.delete', stakeholders(series)); if (!allowed.allowed) return denied(allowed);
        if (!withinRestoreWindow(record.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
        series.recurrence = { ...series.recurrence, exceptions: series.recurrence.exceptions.filter((date) => date !== occurrenceDate) };
        a.occurrenceDeletions = a.occurrenceDeletions.filter((item) => item !== record);
        series.version += 1;
        return ok(structuredClone(series));
      }
      const archived = a.archives.events[id]; const target = state.events.find((item) => item.id === id);
      if (!archived || !target || !seen(target)) return missing('予定');
      const decision = canDeleteResource(viewer(), 'event.delete', stakeholders(target)); if (!decision.allowed) return denied(decision);
      if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      // 削除・回の除外・シリーズの短縮のどれでも、操作前の状態へ戻す。
      Object.assign(target, { ...archived, version: target.version + 1 });
      if (!archived.deletedAt) delete target.deletedAt;
      delete a.archives.events[id];
      return ok(structuredClone(target));
    },
  };
}
