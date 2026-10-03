import { describe, expect, it } from 'vitest';
import { describeRule, isOccurrence, nextOccurrenceAfter, occurrenceDates, parseRRule, remainderRule, withUntil } from './recurrence';

const weekly = (rrule: string, exceptions: string[] = []) => ({ rrule, timezone: 'Asia/Tokyo', exceptions: exceptions as `${number}-${number}-${number}`[] });

describe('recurrence', () => {
  it('expands weekly rules within the range and skips exceptions', () => {
    expect(occurrenceDates('2026-09-30', weekly('FREQ=WEEKLY;BYDAY=WE', ['2026-10-14']), '2026-09-01', '2026-10-31')).toEqual(['2026-09-30', '2026-10-07', '2026-10-21', '2026-10-28']);
  });

  it('handles several weekdays, intervals, UNTIL and COUNT', () => {
    expect(occurrenceDates('2026-10-06', weekly('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH'), '2026-10-01', '2026-10-31')).toEqual(['2026-10-06', '2026-10-08', '2026-10-20', '2026-10-22']);
    expect(occurrenceDates('2026-10-01', weekly('FREQ=DAILY;UNTIL=20261003'), '2026-09-01', '2026-12-31')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(occurrenceDates('2026-10-01', weekly('FREQ=DAILY;COUNT=3', ['2026-10-02']), '2026-09-01', '2026-12-31')).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('skips months without the day for monthly rules', () => {
    expect(occurrenceDates('2026-01-31', weekly('FREQ=MONTHLY'), '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('rejects unsupported rules instead of guessing', () => {
    expect(parseRRule('FREQ=YEARLY')).toBeNull();
    expect(parseRRule('FREQ=WEEKLY;BYSETPOS=1')).toBeNull();
    expect(occurrenceDates('2026-10-01', weekly('FREQ=YEARLY'), '2026-01-01', '2027-12-31')).toEqual(['2026-10-01']);
  });

  it('splits a series for "this and following" without losing COUNT semantics', () => {
    expect(withUntil('FREQ=WEEKLY;BYDAY=WE;COUNT=5', '2026-10-13')).toBe('FREQ=WEEKLY;BYDAY=WE;UNTIL=20261013');
    expect(remainderRule('2026-09-30', weekly('FREQ=WEEKLY;BYDAY=WE;COUNT=5'), '2026-10-14')).toBe('FREQ=WEEKLY;BYDAY=WE;COUNT=3');
    expect(isOccurrence('2026-09-30', weekly('FREQ=WEEKLY;BYDAY=WE'), '2026-10-07')).toBe(true);
    expect(isOccurrence('2026-09-30', weekly('FREQ=WEEKLY;BYDAY=WE'), '2026-10-08')).toBe(false);
    expect(nextOccurrenceAfter('2026-10-01', weekly('FREQ=WEEKLY;BYDAY=TH'), '2026-10-01')).toBe('2026-10-08');
  });

  it('describes rules in Japanese from the rule itself', () => {
    expect(describeRule('2026-09-30', weekly('FREQ=WEEKLY;BYDAY=WE'))).toBe('毎週水曜');
    expect(describeRule('2026-10-06', weekly('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH'))).toBe('2週間ごと（火・木曜）');
    expect(describeRule('2026-10-15', weekly('FREQ=MONTHLY;UNTIL=20261231'))).toBe('毎月15日・12月31日まで');
    expect(describeRule('2026-10-15', weekly('FREQ=DAILY;COUNT=3'))).toBe('毎日・3回');
  });
});
