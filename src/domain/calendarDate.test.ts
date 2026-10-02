import { describe, expect, it } from 'vitest';
import {
  calendarMonthFromUrl,
  dateKeyFromRfc3339,
  monthGrid,
  monthKeyFromRfc3339,
  normalizeSelectedDate,
  shiftMonthKey,
  urlWithCalendarMonth,
  weekDates,
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
    expect(urlWithCalendarMonth('/calendar?month=2026-10&actor=member-aoi', '2026-09', '2026-09')).toBe('/calendar?actor=member-aoi');
  });
});
