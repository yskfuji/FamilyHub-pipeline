import { describe, expect, it } from 'vitest';
import {
  calendarMonthFromUrl,
  isCalendarDayKey,
  movedDateKey,
  dateKeyFromRfc3339,
  monthGrid,
  monthKeyFromRfc3339,
  normalizeSelectedDate,
  readCalendarLocation,
  shiftMonthKey,
  weekDates,
  writeCalendarLocation,
} from './calendarDate';

describe('calendar date utilities', () => {
  it('moves across year boundaries', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('builds a six-week grid including leap day', () => {
    const grid = monthGrid('2028-02');
    expect(grid).toHaveLength(42);
    expect(grid.some((day) => day.date === '2028-02-29' && day.inCurrentMonth)).toBe(true);
  });

  it('uses the Tokyo calendar date at an offset boundary', () => {
    expect(monthKeyFromRfc3339('2026-09-30T15:30:00Z')).toBe('2026-10');
    expect(dateKeyFromRfc3339('2026-09-30T15:30:00Z')).toBe('2026-10-01');
  });

  it('normalizes a day left in another month', () => {
    expect(normalizeSelectedDate('2026-09-30', '2026-10')).toBeNull();
    expect(normalizeSelectedDate('2026-10-12', '2026-10')).toBe('2026-10-12');
  });

  it('builds a Sunday through Saturday week across a month end', () => {
    expect(weekDates('2026-10-01')).toEqual([
      '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03',
    ]);
  });

  it('rejects an invalid route and omits the current month query', () => {
    expect(calendarMonthFromUrl('/calendar?month=2026-13', '2026-09')).toBe('2026-09');
    expect(writeCalendarLocation('/calendar?month=2026-10&actor=member-aoi', { view: 'month', monthKey: '2026-09', selected: '2026-09-30' }, '2026-09-30')).toBe('/calendar?actor=member-aoi');
  });
});

describe('calendar location', () => {
  const today = '2026-09-30';
  const read = (url: string) => readCalendarLocation(url, today, 'month');

  it('defaults to the remembered view and today', () => {
    expect(readCalendarLocation('/calendar', today, 'week')).toEqual({ view: 'week', monthKey: '2026-09', selected: today });
  });

  it('reads view, month and date from the URL', () => {
    expect(read('/calendar?view=day&on=2026-10-08')).toEqual({ view: 'day', monthKey: '2026-10', selected: '2026-10-08' });
    expect(read('/calendar?month=2026-10')).toEqual({ view: 'month', monthKey: '2026-10', selected: null });
  });

  it('ignores values that are not valid', () => {
    expect(read('/calendar?view=year&on=2026-02-31&month=2026-13')).toEqual({ view: 'month', monthKey: '2026-09', selected: today });
  });

  it('writes only what differs from the defaults and keeps other parameters', () => {
    expect(writeCalendarLocation('/calendar?on=2026-10-08&view=day', { view: 'month', monthKey: '2026-09', selected: today }, today)).toBe('/calendar');
    expect(writeCalendarLocation('/calendar?actor=member-hana', { view: 'week', monthKey: '2026-10', selected: '2026-10-08' }, today)).toBe('/calendar?actor=member-hana&view=week&month=2026-10&on=2026-10-08');
  });

  it('survives a round trip', () => {
    const state = { view: 'list', monthKey: '2026-11', selected: null } as const;
    expect(read(writeCalendarLocation('/calendar', state, today))).toEqual(state);
  });

  it('always names the occurrence on a detail URL, even today', () => {
    expect(writeCalendarLocation('/calendar', { view: 'month', monthKey: '2026-09', selected: today }, today, '/calendar/event-clean', today)).toBe('/calendar/event-clean?on=2026-09-30');
  });
});

describe('movedDateKey', () => {
  it('左右は1日、上下は1週', () => {
    expect(movedDateKey('2026-10-01', 'ArrowLeft')).toBe('2026-09-30');
    expect(movedDateKey('2026-10-31', 'ArrowRight')).toBe('2026-11-01');
    expect(movedDateKey('2026-10-14', 'ArrowUp')).toBe('2026-10-07');
    expect(movedDateKey('2026-10-14', 'ArrowDown')).toBe('2026-10-21');
  });
  it('Home と End は週の端（日曜と土曜）', () => {
    expect(movedDateKey('2026-10-14', 'Home')).toBe('2026-10-11');
    expect(movedDateKey('2026-10-14', 'End')).toBe('2026-10-17');
    expect(movedDateKey('2026-10-11', 'Home')).toBe('2026-10-11');
  });
  it('PageUp と PageDown は前後の月で、ない日は月末にする', () => {
    expect(movedDateKey('2026-01-31', 'PageDown')).toBe('2026-02-28');
    expect(movedDateKey('2026-03-31', 'PageUp')).toBe('2026-02-28');
    expect(movedDateKey('2026-12-15', 'PageDown')).toBe('2027-01-15');
    expect(movedDateKey('2024-01-31', 'PageDown')).toBe('2024-02-29');
  });
  it('対象のキーだけを受け付ける', () => {
    expect(isCalendarDayKey('PageDown')).toBe(true);
    expect(isCalendarDayKey('Enter')).toBe(false);
  });
});
