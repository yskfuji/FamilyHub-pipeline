import { describe, expect, it } from 'vitest';
import { capabilitiesFor, capabilityCeilingFor } from '../../authz/policy';
import { initialAggregate } from '../../data/mockGateway';
import { createHouseholdRules } from './index';

const rulesFor = (actorMembershipId: string, overrides: Parameters<typeof capabilitiesFor>[1] = []) => {
  const aggregate = initialAggregate();
  aggregate.permissionOverrides = overrides;
  return createHouseholdRules(aggregate, { actorMembershipId, now: () => '2026-09-30T07:45:00+09:00', nextId: (prefix) => `${prefix}-1`, newInviteToken: () => 'token' });
};

describe('assistant.use', () => {
  it('belongs to owners and adults only, and cannot be raised for a child or a guest', () => {
    expect(capabilitiesFor('owner')).toContain('assistant.use');
    expect(capabilitiesFor('adult')).toContain('assistant.use');
    for (const role of ['child', 'guest'] as const) {
      expect(capabilitiesFor(role)).not.toContain('assistant.use');
      expect(capabilityCeilingFor(role)).not.toContain('assistant.use');
      expect(capabilitiesFor(role, [{ membershipId: 'x', capability: 'assistant.use', effect: 'allow' }])).not.toContain('assistant.use');
    }
  });

  it('turns the feature off for one adult when an owner denies it', () => {
    const rules = rulesFor('member-ren', [{ membershipId: 'member-ren', capability: 'assistant.use', effect: 'deny' }]);
    expect(rules.assistant.status(true)).toEqual({ ok: true, value: { available: false } });
    expect(rules.assistant.authorize('receipt')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', reason: 'CAPABILITY_MISSING' } });
  });

  it('asks for the right to use the result, too', () => {
    const noExpense = rulesFor('member-ren', [{ membershipId: 'member-ren', capability: 'expense.create', effect: 'deny' }]);
    expect(noExpense.assistant.authorize('receipt')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(noExpense.assistant.authorize('event')).toEqual({ ok: true, value: undefined });
    const noEvent = rulesFor('member-ren', [{ membershipId: 'member-ren', capability: 'event.create', effect: 'deny' }]);
    expect(noEvent.assistant.authorize('event')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('reports unavailable when the feature is off, whoever asks', () => expect(rulesFor('member-aoi').assistant.status(false)).toEqual({ ok: true, value: { available: false } }));
});
