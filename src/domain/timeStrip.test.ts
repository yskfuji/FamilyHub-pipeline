import { describe, expect, it } from 'vitest';
import { stripLanes } from './timeStrip';

describe('stripLanes (time strip on Today)', () => {
  const range = 18 * 60;
  it('keeps marks that are apart on one lane', () => {
    expect(stripLanes([{ start: 9 * 60 + 30, minutes: 90 }, { start: 18 * 60, minutes: 0 }], range)).toEqual([0, 0]);
  });
  it('moves the 19:30 and 20:00 due dots and an overlapping event to separate lanes', () => {
    expect(stripLanes([{ start: 18 * 60, minutes: 0 }, { start: 19 * 60 + 30, minutes: 0 }, { start: 20 * 60, minutes: 0 }], range)).toEqual([0, 0, 1]);
    expect(stripLanes([{ start: 18 * 60, minutes: 120 }, { start: 19 * 60, minutes: 0 }, { start: 21 * 60, minutes: 0 }], range)).toEqual([0, 1, 0]);
  });
  it('reuses the first lane that is free again', () => {
    expect(stripLanes([{ start: 600, minutes: 0 }, { start: 610, minutes: 0 }, { start: 620, minutes: 0 }, { start: 900, minutes: 0 }], range)).toEqual([0, 1, 2, 0]);
  });
});
