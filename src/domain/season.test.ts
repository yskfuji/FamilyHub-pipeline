import { describe, expect, it } from 'vitest';
import { seasonOf } from './season';

describe('seasonOf', () => {
  it('月の区切りで季節が変わる', () => {
    expect(['2026-02-28', '2026-03-01', '2026-05-31', '2026-06-01', '2026-08-31', '2026-09-01', '2026-11-30', '2026-12-01'].map(seasonOf)).toEqual(['winter', 'spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter']);
  });
  it('年月だけでも読める', () => {
    expect(seasonOf('2026-01')).toBe('winter');
    expect(seasonOf('2026-10')).toBe('autumn');
  });
});
