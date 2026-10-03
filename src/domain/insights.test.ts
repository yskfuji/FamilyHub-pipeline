import { describe, expect, it } from 'vitest';
import { baseSnapshot } from '../data/fixtures';
import { deriveInsights } from './insights';

describe('derived insights', () => {
  it('derives insights from records instead of fixed copy', () => {
    const ids = deriveInsights(baseSnapshot).map((item) => item.id);
    expect(ids).toEqual(['insight-review-waiting', 'insight-due-today', 'insight-unsettled', 'insight-holiday']);
    const unsettled = deriveInsights(baseSnapshot).find((item) => item.id === 'insight-unsettled');
    expect(unsettled?.title).toMatch(/^未精算は合計[¥￥]3,110$/);
  });

  it('only links weather to weather-sensitive events happening today', () => {
    const park = baseSnapshot.events.find((event) => event.id === 'event-park')!;
    const today = { ...baseSnapshot, events: [...baseSnapshot.events, { ...park, id: 'event-today', startsAt: '2026-09-30T15:00:00+09:00', endsAt: '2026-09-30T16:00:00+09:00' }] };
    expect(deriveInsights(baseSnapshot).some((item) => item.id === 'insight-weather')).toBe(false);
    expect(deriveInsights(today).find((item) => item.id === 'insight-weather')?.destination).toBe('/calendar/event-today');
  });

  it('omits money insights for viewers without budget access', () => {
    const child = { ...baseSnapshot, viewer: { ...baseSnapshot.viewer, membershipId: 'member-hana', capabilities: baseSnapshot.viewer.capabilities.filter((item) => item !== 'expense.read') } };
    expect(deriveInsights(child).some((item) => item.id === 'insight-unsettled')).toBe(false);
  });
});
