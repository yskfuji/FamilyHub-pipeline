import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../../data/fixtures';
import { capabilitiesFor } from '../../authz/policy';
import type { CalendarEvent, HouseholdSnapshot, Todo } from '../types';
import { weekLoad } from './weekLoad';

const eventBase = baseSnapshot.events[0];
const todoBase = baseSnapshot.todos[0];
const event = (id: string, startsAt: string, endsAt: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ ...eventBase, id, title: id, startsAt, endsAt, recurrence: undefined, allDay: false, deletedAt: undefined, ...extra });
const todo = (id: string, dueAt: string | undefined, extra: Partial<Todo> = {}): Todo => ({ ...todoBase, id, title: id, status: 'open', dueAt, dueStartAt: undefined, recurrence: undefined, deletedAt: undefined, ...extra });
const snapshot = (changes: Partial<HouseholdSnapshot>, asOf = baseSnapshot.context.asOf): HouseholdSnapshot => ({ ...baseSnapshot, events: [], todos: [], ...changes, context: { ...baseSnapshot.context, asOf } });

describe('weekly load', () => {
  it('lists seven days from today in the household time zone', () => {
    // 2026-10-04T15:30Z is 00:30 on Monday 5 October in Tokyo.
    const load = weekLoad(snapshot({}, '2026-10-04T15:30:00Z'));
    expect(load.days.map((day) => day.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(load.total).toBe(0);
  });

  it('counts events per day, a spanning event on each of its days and an event ending at midnight only on its first day', () => {
    const load = weekLoad(snapshot({ events: [
      event('朝', '2026-09-30T08:00:00+09:00', '2026-09-30T09:00:00+09:00'),
      event('夜まで', '2026-09-30T22:00:00+09:00', '2026-10-01T00:00:00+09:00'),
      event('二日', '2026-10-01T10:00:00+09:00', '2026-10-02T12:00:00+09:00'),
      event('消した', '2026-10-01T10:00:00+09:00', '2026-10-01T11:00:00+09:00', { deletedAt: '2026-09-29T10:00:00+09:00' }),
      event('先', '2026-10-07T10:00:00+09:00', '2026-10-07T11:00:00+09:00'),
    ] }));
    expect(load.days.map((day) => day.events)).toEqual([2, 1, 1, 0, 0, 0, 0]);
  });

  it('counts each occurrence of a repeating event', () => {
    const daily = event('毎日', '2026-09-01T07:00:00+09:00', '2026-09-01T07:30:00+09:00', { recurrence: { rrule: 'FREQ=DAILY', timezone: 'Asia/Tokyo', exceptions: [] } });
    expect(weekLoad(snapshot({ events: [daily] })).days.map((day) => day.events)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('counts open tasks on their due day and leaves out done, undated and overdue ones', () => {
    const load = weekLoad(snapshot({ todos: [
      todo('今日', '2026-09-30T20:00:00+09:00'),
      todo('日付の境目', '2026-09-30T15:30:00Z'), // 10月1日 0:30
      todo('終わった', '2026-10-01T20:00:00+09:00', { status: 'done' }),
      todo('期限なし', undefined),
      todo('過ぎた', '2026-09-28T20:00:00+09:00'),
      todo('期間', '2026-10-03T20:00:00+09:00', { dueStartAt: '2026-10-02T09:00:00+09:00' }),
    ] }));
    expect(load.days.map((day) => day.tasks)).toEqual([1, 1, 1, 1, 0, 0, 0]);
    expect(load.total).toBe(4);
  });

  it('counts only the kinds that are chosen and that the viewer may read', () => {
    const value = snapshot({ events: [event('朝', '2026-09-30T08:00:00+09:00', '2026-09-30T09:00:00+09:00')], todos: [todo('今日', '2026-09-30T20:00:00+09:00')] });
    expect(weekLoad(value, { events: false, tasks: true, expenses: true })).toMatchObject({ counted: { events: false, tasks: true }, total: 1 });
    expect(weekLoad(value, { events: true, tasks: false, expenses: true }).days[0]).toEqual({ date: '2026-09-30', events: 1, tasks: 0 });
    const guest = { ...value, viewer: { ...value.viewer, role: 'guest' as const, capabilities: capabilitiesFor('guest').filter((item) => item !== 'task.read') } };
    expect(weekLoad(guest).counted.tasks).toBe(false);
  });

  it('matches the sample household', () => {
    const load = weekLoad(baseSnapshot);
    expect(load.days[0].date).toBe('2026-09-30');
    expect(load.total).toBe(load.days.reduce((sum, day) => sum + day.events + day.tasks, 0));
    expect(load.days[0].events).toBeGreaterThan(0);
  });
});
