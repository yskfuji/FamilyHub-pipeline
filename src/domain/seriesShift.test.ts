import { describe, expect, it } from 'vitest';
import { addDateKeyDays } from './calendarDate';
import { occurrenceDates } from './recurrence';
import { describeSeriesShift, seriesShiftRefusalMessage, shiftOccurrenceDeletions, shiftSeries } from './seriesShift';
import type { SeriesShiftRefusal } from './seriesShift';
import type { CalendarEvent, IsoDate, OccurrenceDeletion, RecurrenceRule } from './types';

const event = (startKey: string, rrule: string, exceptions: string[] = []): CalendarEvent => ({
  id: 'event-series', householdId: 'house', title: '繰り返し', startsAt: `${startKey}T09:30:00+09:00`, endsAt: `${startKey}T10:15:00+09:00`, timezone: 'Asia/Tokyo',
  ownerMembershipId: 'member', participantMembershipIds: ['member'], version: 3,
  recurrence: { rrule, timezone: 'Asia/Tokyo', exceptions: exceptions as IsoDate[] },
  visibility: { audience: 'household', creatorMembershipId: 'member', selectedMembershipIds: [] },
});

/** 回の集合（開始日から2年と少し）。 */
const span = 800;
const datesOf = (item: CalendarEvent) => {
  const start = item.startsAt.slice(0, 10);
  return occurrenceDates(start, item.recurrence as RecurrenceRule, addDateKeyDays(start, -10), addDateKeyDays(start, span));
};

/** 試験を同じ順で繰り返せるように、種から作る乱数（mulberry32）。 */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

describe('shiftSeries (A13)', () => {
  it('moves every occurrence by the same number of days, for every rule it accepts (property, seeded)', () => {
    const next = random(20261103);
    const pick = (count: number) => Math.floor(next() * count);
    const accepted: Record<string, number> = { DAILY: 0, WEEKLY: 0, WEEKLY_INTERVAL: 0, MONTHLY: 0, MONTHLY_BYMONTHDAY: 0 };
    const refused: Partial<Record<SeriesShiftRefusal, number>> = {};
    for (let round = 0; round < 3000; round += 1) {
      const start = addDateKeyDays('2025-01-01', pick(1500));
      const freq = ['DAILY', 'WEEKLY', 'MONTHLY'][pick(3)];
      const parts = [`FREQ=${freq}`];
      const interval = 1 + pick(freq === 'DAILY' ? 9 : 3);
      if (interval > 1) parts.push(`INTERVAL=${interval}`);
      if (freq === 'WEEKLY' && next() < 0.8) parts.push(`BYDAY=${[...new Set(Array.from({ length: 1 + pick(3) }, () => DAYS[pick(7)]))].join(',')}`);
      if (freq === 'MONTHLY' && next() < 0.6) {
        parts.push(`BYMONTHDAY=${[...new Set(Array.from({ length: 1 + pick(3) }, () => 1 + pick(next() < 0.85 ? 28 : 31)))].join(',')}`);
        if (next() < 0.15) parts.push(`BYSETPOS=${next() < 0.5 ? 1 : -1}`);
      }
      const end = next();
      if (end < 0.25) parts.push(`UNTIL=${addDateKeyDays(start, 30 + pick(700)).replaceAll('-', '')}`);
      else if (end < 0.45) parts.push(`COUNT=${1 + pick(40)}`);
      const plain = event(start, parts.join(';'));
      const first = datesOf(plain);
      const exceptions = first.filter(() => next() < 0.08).slice(0, 4);
      const original = event(start, parts.join(';'), exceptions);
      const delta = (1 + pick(10)) * (next() < 0.5 ? -1 : 1);
      const shifted = shiftSeries(original, delta);
      if (!shifted.ok) { refused[shifted.reason] = (refused[shifted.reason] ?? 0) + 1; continue; }
      const key = freq === 'WEEKLY' && interval > 1 ? 'WEEKLY_INTERVAL' : freq === 'MONTHLY' && parts.some((part) => part.startsWith('BYMONTHDAY')) ? 'MONTHLY_BYMONTHDAY' : freq;
      accepted[key] += 1;
      const expected = datesOf(original).map((date) => addDateKeyDays(date, delta));
      const actual = datesOf(shifted.event).filter((date) => date <= addDateKeyDays(start, span + delta));
      expect({ rule: original.recurrence?.rrule, start, delta, dates: actual }).toEqual({ rule: original.recurrence?.rrule, start, delta, dates: expected.filter((date) => date <= addDateKeyDays(start, span + delta)) });
      expect(shifted.event.startsAt).toBe(`${addDateKeyDays(start, delta)}T09:30:00+09:00`);
      expect(shifted.event.endsAt).toBe(`${addDateKeyDays(start, delta)}T10:15:00+09:00`);
    }
    // 試験が空振りしていないこと。どの種類の規則も十分に受け付け、どの理由も一度は現れる。
    for (const count of Object.values(accepted)) expect(count).toBeGreaterThan(80);
    expect(Object.keys(refused).sort()).toEqual(['crosses-week', 'month-end', 'out-of-range', 'set-position']);
  });

  it('refuses the every-other-weekend rule moved by one day, since the pair would cross the week (audit counter-example)', () => {
    const weekend = event('2026-11-07', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA,SU');
    expect(shiftSeries(weekend, 1)).toEqual({ ok: false, reason: 'crosses-week' });
    // そのまま曜日を回すと、正しい {11/08, 11/16, 11/22, 11/30} にならない。拒否が必要なことの確認。
    const naive = event('2026-11-08', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO');
    expect(datesOf(naive).slice(0, 4)).not.toEqual(['2026-11-08', '2026-11-16', '2026-11-22', '2026-11-30']);
    expect(datesOf(weekend).slice(0, 4).map((date) => addDateKeyDays(date, 1))).toEqual(['2026-11-08', '2026-11-16', '2026-11-22', '2026-11-30']);
  });

  it('refuses a monthly day 28 moved later, the month end, and a chosen position (audit counter-example)', () => {
    expect(shiftSeries(event('2026-10-28', 'FREQ=MONTHLY;BYMONTHDAY=28'), 1)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(shiftSeries(event('2026-10-28', 'FREQ=MONTHLY'), 1)).toEqual({ ok: false, reason: 'out-of-range' });
    expect(shiftSeries(event('2026-10-31', 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1'), -1)).toEqual({ ok: false, reason: 'month-end' });
    expect(shiftSeries(event('2026-10-30', 'FREQ=MONTHLY'), -2)).toEqual({ ok: false, reason: 'month-end' });
    expect(shiftSeries(event('2026-10-01', 'FREQ=MONTHLY;BYMONTHDAY=1,15;BYSETPOS=1'), 1)).toEqual({ ok: false, reason: 'set-position' });
    expect(shiftSeries(event('2026-10-01', 'FREQ=MONTHLY;BYMONTHDAY=1'), -1)).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('moves the rule, the exceptions and UNTIL, and keeps COUNT', () => {
    const weekly = shiftSeries(event('2026-10-01', 'FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231', ['2026-10-08']), 1);
    expect(weekly).toMatchObject({ ok: true, event: { startsAt: '2026-10-02T09:30:00+09:00', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=FR;UNTIL=20270101', exceptions: ['2026-10-09'] } } });
    const monthly = shiftSeries(event('2026-10-15', 'FREQ=MONTHLY;BYMONTHDAY=5,15;COUNT=6'), -3);
    expect(monthly).toMatchObject({ ok: true, event: { startsAt: '2026-10-12T09:30:00+09:00', recurrence: { rrule: 'FREQ=MONTHLY;BYMONTHDAY=2,12;COUNT=6' } } });
  });

  it('keeps the series as it is when the date does not move', () => {
    const series = event('2026-10-31', 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
    expect(shiftSeries(series, 0)).toEqual({ ok: true, event: series });
  });

  it('moves the single-occurrence deletions of this series only', () => {
    const deletions: OccurrenceDeletion[] = [
      { eventId: 'event-series', occurrenceDate: '2026-10-08' as IsoDate, deletedAt: '2026-10-01T00:00:00+09:00', title: 'a' },
      { eventId: 'event-other', occurrenceDate: '2026-10-08' as IsoDate, deletedAt: '2026-10-01T00:00:00+09:00', title: 'b' },
    ];
    expect(shiftOccurrenceDeletions(deletions, 'event-series', -2).map((item) => item.occurrenceDate)).toEqual(['2026-10-06', '2026-10-08']);
  });

  it('describes the move before saving, or the reason it cannot move with the way to "this and following"', () => {
    expect(describeSeriesShift(event('2026-10-07', 'FREQ=WEEKLY;BYDAY=WE'), 1)).toBe('すべての予定を1日後へ移します（毎週木曜）');
    expect(describeSeriesShift(event('2026-10-07', 'FREQ=WEEKLY'), -2)).toBe('すべての予定を2日前へ移します（毎週月曜）');
    expect(describeSeriesShift(event('2026-10-28', 'FREQ=MONTHLY;BYMONTHDAY=28'), 1)).toBeNull();
    expect(describeSeriesShift(event('2026-10-07', 'FREQ=WEEKLY'), 0)).toBeNull();
    expect(seriesShiftRefusalMessage('month-end')).toContain('「これ以降の予定」');
  });
});
