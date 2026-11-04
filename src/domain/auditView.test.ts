import { describe, expect, it } from 'vitest';
import { auditFieldLabels, auditFieldsText } from '../content/auditLabels';
import { accountUpdateSchema } from './account';
import { albumUpdateSchema, eventUpdateSchema, expenseUpdateSchema, memoInputSchema, todoUpdateSchema } from './schemas';
import { AUDIT_PAGE_SIZE, auditQueryFor, auditSearch, auditTargetHref, groupByDay, periodRange, readAuditFilters } from './auditView';

describe('the change record screen (A5-8)', () => {
  const members = ['member-aoi', 'member-ren'];

  it('reads filters from the URL, ignores unknown values, and writes them back', () => {
    expect(readAuditFilters('?who=member-ren&kind=expenses&period=week', members)).toEqual({ view: 'household', membershipId: 'member-ren', group: 'expenses', period: 'week' });
    expect(readAuditFilters('?who=member-x&kind=secret&period=year', members)).toEqual({ view: 'household', membershipId: null, group: null, period: 'all' });
    expect(readAuditFilters('?view=mine&who=member-ren', members).view).toBe('mine');
    expect(auditSearch({ view: 'household', membershipId: 'member-ren', group: 'expenses', period: 'week' })).toBe('?who=member-ren&kind=expenses&period=week');
    expect(auditSearch({ view: 'household', membershipId: null, group: null, period: 'all' })).toBe('');
    expect(auditSearch({ view: 'mine', membershipId: 'member-ren', group: 'expenses', period: 'week' })).toBe('?view=mine');
  });

  it('turns a period into a date range that ends today in the household time zone', () => {
    expect(periodRange('all', '2026-09-30')).toEqual({});
    expect(periodRange('today', '2026-09-30')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
    expect(periodRange('week', '2026-09-30')).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(periodRange('month', '2026-10-05')).toEqual({ from: '2026-09-06', to: '2026-10-05' });
    expect(auditQueryFor({ view: 'household', membershipId: 'member-ren', group: 'albums', period: 'today' }, '2026-09-30T23:30:00+09:00', '42'))
      .toEqual({ limit: AUDIT_PAGE_SIZE, cursor: '42', membershipId: 'member-ren', group: 'albums', from: '2026-09-30', to: '2026-09-30' });
  });

  it('groups by day without changing the order', () => {
    const rows = [{ at: '2026-09-30T08:00:00+09:00', id: 'a' }, { at: '2026-09-30T07:00:00+09:00', id: 'b' }, { at: '2026-09-29T21:00:00+09:00', id: 'c' }];
    expect(groupByDay(rows).map((day) => [day.day, day.items.map((item) => item.id)])).toEqual([['2026-09-30', ['a', 'b']], ['2026-09-29', ['c']]]);
    expect(groupByDay([])).toEqual([]);
  });

  it('links only to targets the viewer can see', () => {
    expect(auditTargetHref({ kind: 'expense', id: 'expense-books', hidden: false })).toBe('/budget/expense-books');
    expect(auditTargetHref({ kind: 'settlementBatch', id: 'b-1', hidden: false })).toBe('/budget?view=settlements');
    expect(auditTargetHref({ kind: 'expense', id: null, hidden: true })).toBeNull();
    expect(auditTargetHref({ kind: 'notification', id: 'n-1', hidden: false })).toBeNull();
    expect(auditTargetHref(null)).toBeNull();
  });

  it('names every field a change can record, and never shows the raw key', () => {
    for (const schema of [accountUpdateSchema, albumUpdateSchema, eventUpdateSchema, expenseUpdateSchema, memoInputSchema, todoUpdateSchema] as unknown as Array<{ shape: object }>) {
      for (const key of Object.keys(schema.shape)) expect(auditFieldLabels[key], key).toMatch(/[぀-ヿ㐀-鿿]/);
    }
    expect(auditFieldsText(['kind', 'category', 'shareAmounts', 'shareMembershipIds'])).toBe('種類・費目・負担');
    expect(auditFieldsText(['futureField'])).toBe('そのほかの項目');
  });
});
