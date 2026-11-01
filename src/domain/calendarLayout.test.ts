import { describe, expect, it } from 'vitest';
import { LAST_DAY_OF_MONTH_RULE } from './recurrence';
import { clockOf, expandEvent, expensesOn, initialTimelineMinutes, isSpanning, lastDateOf, layoutLanes, layoutTimeline, MIN_BLOCK_MINUTES, minutesOfDay, monthWeeks, occurrencesBetween, occurrenceStartingOn, occursOn, slotMinutes, todosOn } from './calendarLayout';
import type { CalendarEvent, Expense, Todo } from './types';

const event = (id: string, startsAt: string, endsAt: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, householdId: 'h', title: id, startsAt: `${startsAt}+09:00`, endsAt: `${endsAt}+09:00`, timezone: 'Asia/Tokyo', ownerMembershipId: 'a', participantMembershipIds: ['a'], version: 1, visibility: { audience: 'household', creatorMembershipId: 'a', selectedMembershipIds: [] }, ...extra });
const week = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
const expand = (...events: CalendarEvent[]) => occurrencesBetween(events, week[0], week[6]);
const multi = (id: string, from: string, to: string) => event(id, `2026-10-${from}T09:00:00`, `2026-10-${to}T10:00:00`);
const timed = (id: string, day: string, from: string, to: string) => event(id, `2026-10-${day}T${from}:00`, `2026-10-${day}T${to}:00`);
const lanesOf = (placements: ReturnType<typeof layoutLanes>['placements']) => Object.fromEntries(placements.map((item) => [item.occurrence.id, item.lane]));

describe('occurrences', () => {
  it('treats an end at exactly midnight as belonging to the previous day', () => {
    expect(lastDateOf(event('x', '2026-10-05T22:00:00', '2026-10-06T00:00:00'))).toBe('2026-10-05');
    expect(lastDateOf(event('x', '2026-10-05T22:00:00', '2026-10-06T00:30:00'))).toBe('2026-10-06');
  });

  it('keeps events that started before the range and are still running', () => {
    const items = expandEvent(multi('x', '02', '05'), '2026-10-04', '2026-10-10');
    expect(items.map((item) => item.occurrenceDate)).toEqual(['2026-10-02']);
    expect(expandEvent(multi('x', '02', '03'), '2026-10-04', '2026-10-10')).toEqual([]);
  });

  it('repeats a multi-day event and keeps its length', () => {
    const items = expandEvent(event('x', '2026-10-05T09:00:00', '2026-10-06T10:00:00', { recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'Asia/Tokyo', exceptions: [] } }), '2026-10-13', '2026-10-13');
    expect(items).toHaveLength(1);
    expect(items[0].occurrenceDate).toBe('2026-10-12');
    expect(items[0].endsAt.slice(0, 10)).toBe('2026-10-13');
    expect(occursOn(items[0], '2026-10-13')).toBe(true);
  });

  it('finds an occurrence only on the day it starts', () => {
    const series = event('x', '2026-10-31T09:00:00', '2026-10-31T10:00:00', { recurrence: { rrule: LAST_DAY_OF_MONTH_RULE, timezone: 'Asia/Tokyo', exceptions: [] } });
    expect(occurrenceStartingOn(series, '2026-11-30')?.occurrenceDate).toBe('2026-11-30');
    expect(occurrenceStartingOn(series, '2026-11-29')).toBeUndefined();
  });

  it('reads the time of day in Japan regardless of the offset in the value', () => {
    expect(minutesOfDay('2026-10-05T01:30:00Z')).toBe(630);
  });

  it('draws all-day and multi-day events as ribbons and keeps single-day timed events as items', () => {
    const [ribbon] = expand(multi('x', '05', '06'));
    const [allDay] = expand(event('y', '2026-10-05T00:00:00', '2026-10-05T23:59:00', { allDay: true }));
    const [single] = expand(timed('z', '05', '09:00', '10:00'));
    expect([isSpanning(ribbon), isSpanning(allDay), isSpanning(single)]).toEqual([true, true, false]);
  });
});

describe('layoutLanes', () => {
  it('shares lanes between ribbons that do not overlap', () => {
    const { placements, hidden } = layoutLanes(week, expand(multi('a', '04', '05'), multi('b', '06', '08'), multi('c', '05', '06')), 4);
    expect(lanesOf(placements)).toEqual({ a: 0, b: 0, c: 1 });
    expect(hidden).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('puts a single-day item in the first lane its column has free, not below every ribbon of the week', () => {
    const { placements } = layoutLanes(week, expand(multi('a', '04', '05'), timed('b', '05', '09:00', '10:00'), timed('c', '08', '09:00', '10:00')), 4);
    expect(lanesOf(placements)).toEqual({ a: 0, b: 1, c: 0 });
  });

  it('marks continuation at the edges of the week', () => {
    const { placements } = layoutLanes(week, expand(event('a', '2026-10-02T09:00:00', '2026-10-13T10:00:00')), 4);
    expect(placements[0]).toMatchObject({ colStart: 0, colEnd: 6, continuesBefore: true, continuesAfter: true });
  });

  it('counts what does not fit and leaves the last lane for the +n marker', () => {
    const items = ['09:00', '10:00', '11:00', '12:00', '13:00'].map((time, index) => timed(`t${index}`, '06', time, time.replace(':00', ':30')));
    const { placements, hidden } = layoutLanes(week, expand(...items), 4);
    expect(placements.map((item) => item.lane)).toEqual([0, 1, 2]);
    expect(hidden[2]).toBe(2);
  });

  it('shows everything when the items exactly fill the lanes', () => {
    const items = ['09:00', '10:00', '11:00'].map((time, index) => timed(`t${index}`, '06', time, time.replace(':00', ':30')));
    expect(layoutLanes(week, expand(...items), 3)).toMatchObject({ hidden: [0, 0, 0, 0, 0, 0, 0] });
    expect(layoutLanes(week, expand(...items), 3).placements).toHaveLength(3);
  });

  it('hides a ribbon on every column it covers when one of them is full', () => {
    const singles = ['09:00', '10:00', '11:00'].map((time, index) => timed(`t${index}`, '06', time, time.replace(':00', ':30')));
    const { placements, hidden } = layoutLanes(week, expand(multi('wide', '05', '07'), multi('wide2', '05', '07'), multi('wide3', '05', '07'), ...singles), 3);
    expect(placements.some((item) => item.occurrence.id === 'wide3')).toBe(false);
    expect(hidden[1]).toBeGreaterThan(0);
    expect(hidden[3]).toBeGreaterThan(0);
  });

  it('clips ribbons to the visible month and keeps the continuation marker', () => {
    const dates = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'];
    const items = occurrencesBetween([event('a', '2026-09-29T09:00:00', '2026-10-02T10:00:00')], dates[0], dates[6]);
    expect(layoutLanes(dates, items, 3, { from: '2026-10-01', to: '2026-10-31' }).placements[0]).toMatchObject({ colStart: 4, colEnd: 5, continuesBefore: true, continuesAfter: false });
    expect(layoutLanes(dates, items, 3, { from: '2026-09-01', to: '2026-09-30' }).placements[0]).toMatchObject({ colStart: 2, colEnd: 3, continuesBefore: false, continuesAfter: true });
  });

  it('works for one column as well as seven', () => {
    const [day] = week;
    const { placements } = layoutLanes([day], occurrencesBetween([multi('a', '02', '09')], day, day), 4);
    expect(placements[0]).toMatchObject({ colStart: 0, colEnd: 0, continuesBefore: true, continuesAfter: true });
  });
});

describe('layoutTimeline', () => {
  const date = '2026-10-05';
  const dayOf = (...items: CalendarEvent[]) => occurrencesBetween(items, date, date);

  it('leaves all-day and multi-day events to the all-day row', () => {
    const { blocks } = layoutTimeline(dayOf(multi('a', '05', '06'), event('b', `${date}T00:00:00`, `${date}T23:59:00`, { allDay: true }), timed('c', '05', '09:00', '10:00')), date, 4);
    expect(blocks.map((block) => block.occurrence.id)).toEqual(['c']);
  });

  it('places overlapping events side by side and leaves separate ones full width', () => {
    const { blocks } = layoutTimeline(dayOf(timed('a', '05', '09:00', '11:00'), timed('b', '05', '10:00', '12:00'), timed('c', '05', '13:00', '14:00')), date, 4);
    const by = Object.fromEntries(blocks.map((block) => [block.occurrence.id, block]));
    expect([by.a.column, by.a.columns, by.b.column, by.b.columns]).toEqual([0, 2, 1, 2]);
    expect([by.c.column, by.c.columns]).toEqual([0, 1]);
  });

  it('reuses a column when an earlier event in the group has ended', () => {
    const { blocks } = layoutTimeline(dayOf(timed('a', '05', '09:00', '12:00'), timed('b', '05', '09:30', '10:30'), timed('c', '05', '10:30', '11:30')), date, 4);
    const by = Object.fromEntries(blocks.map((block) => [block.occurrence.id, block]));
    expect(by.c.column).toBe(1);
    expect(by.c.columns).toBe(2);
  });

  it('gives short events a tappable length and treats that length as busy', () => {
    const { blocks } = layoutTimeline(dayOf(timed('a', '05', '09:00', '09:10'), timed('b', '05', '09:30', '10:00')), date, 4);
    expect(blocks[0].end - blocks[0].start).toBe(MIN_BLOCK_MINUTES);
    expect(blocks.map((block) => block.columns)).toEqual([2, 2]);
  });

  it('keeps a block inside the day near midnight', () => {
    const { blocks } = layoutTimeline(dayOf(timed('a', '05', '23:50', '23:55')), date, 4);
    expect(blocks[0].end).toBe(1440);
    expect(blocks[0].start).toBe(1440 - MIN_BLOCK_MINUTES);
  });

  it('counts events beyond the column limit', () => {
    const { blocks, hidden } = layoutTimeline(dayOf(timed('a', '05', '09:00', '11:00'), timed('b', '05', '09:00', '11:00'), timed('c', '05', '09:00', '11:00')), date, 2);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.columns === 2)).toBe(true);
    expect(hidden).toBe(1);
  });
});

describe('time slots', () => {
  it('snaps a position down to a 30-minute slot', () => {
    expect(slotMinutes(64 * 10 + 10, 64)).toBe(600);
    expect(slotMinutes(64 * 10 + 40, 64)).toBe(630);
    expect(clockOf(630)).toBe('10:30');
  });

  it('stays inside the day', () => {
    expect(slotMinutes(-5, 64)).toBe(0);
    expect(slotMinutes(64 * 24 + 5, 64)).toBe(1410);
  });

  it('opens an hour before now on today and at 7:00 on other days', () => {
    expect(initialTimelineMinutes(['2026-09-30'], '2026-09-30', 450)).toBe(390);
    expect(initialTimelineMinutes(['2026-09-30'], '2026-09-30', 30)).toBe(0);
    expect(initialTimelineMinutes(['2026-10-01'], '2026-09-30', 450)).toBe(420);
  });
});

describe('monthWeeks', () => {
  it('drops the trailing week that has no day of the month', () => {
    expect(monthWeeks('2026-02')).toHaveLength(4);
    expect(monthWeeks('2026-08')).toHaveLength(6);
  });
});

describe('day entries', () => {
  const todo = (extra: Partial<Todo>): Todo => ({ id: 't', householdId: 'h', title: 't', status: 'open', assigneeMembershipId: 'a', creatorMembershipId: 'a', version: 1, visibility: { audience: 'household', creatorMembershipId: 'a', selectedMembershipIds: [] }, ...extra });

  it('lists a task on its due day and across its period', () => {
    expect(todosOn([todo({ dueAt: '2026-10-05T20:00:00+09:00' })], '2026-10-05')).toHaveLength(1);
    const period = todo({ dueStartAt: '2026-10-03T09:00:00+09:00', dueAt: '2026-10-05T20:00:00+09:00' });
    expect(todosOn([period], '2026-10-04')).toHaveLength(1);
    expect(todosOn([period], '2026-10-06')).toHaveLength(0);
    expect(todosOn([todo({})], '2026-10-05')).toHaveLength(0);
  });

  it('lists expenses by the day they were incurred', () => {
    expect(expensesOn([{ incurredOn: '2026-10-05' } as unknown as Expense], '2026-10-05')).toHaveLength(1);
  });
});

