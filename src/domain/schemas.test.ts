import { describe, expect, it } from 'vitest';
import { eventInputSchema, expenseInputSchema, passwordSchema, safeHttpsUrlSchema } from './schemas';

describe('domain validation', () => {
  it('requires at least 15 password characters and accepts passphrases', () => {
    expect(passwordSchema.safeParse('短いパスワード').success).toBe(false);
    expect(passwordSchema.safeParse('家族で決めた十分に長い合言葉です').success).toBe(true);
  });

  it('rejects an event ending before it starts', () => {
    expect(eventInputSchema.safeParse({
      title: '歯科',
      startsAt: '2026-09-30T10:00:00+09:00',
      endsAt: '2026-09-30T09:00:00+09:00',
      timezone: 'Asia/Tokyo',
      participantMembershipIds: ['membership-1'],
    }).success).toBe(false);
  });

  it('keeps yen as an integer', () => {
    const value = expenseInputSchema.safeParse({
      title: '教材費', amountJpy: 2200.5, incurredOn: '2026-09-30',
      payerMembershipId: 'membership-1', shareMembershipIds: ['membership-1'],
    });
    expect(value.success).toBe(false);
  });

  it('rejects breached-looking values and non-HTTPS resource URLs', () => {
    expect(passwordSchema.safeParse('123456789012345').success).toBe(false);
    expect(safeHttpsUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(safeHttpsUrlSchema.safeParse('http://example.com').success).toBe(false);
    expect(safeHttpsUrlSchema.safeParse('https://example.com/resource').success).toBe(true);
  });
});
