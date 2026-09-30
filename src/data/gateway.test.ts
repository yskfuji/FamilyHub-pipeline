import { describe, expect, it, vi } from 'vitest';
import { createHttpGateway } from './httpGateway';
import { createMockGateway } from './mockGateway';

describe('mock gateway state transitions', () => {
  it('protects the sole owner and checks membership versions', async () => {
    const gateway = createMockGateway();
    const snapshot = await gateway.household.getSnapshot();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const owner = snapshot.value.memberships.find((member) => member.role === 'owner');
    expect(owner).toBeDefined();
    if (!owner) return;
    const demotion = await gateway.household.updateMembershipRole(owner.id, 'adult', owner.version);
    expect(demotion).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const conflict = await gateway.household.updateMembershipRole(owner.id, 'owner', owner.version + 1);
    expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('rejects an individual permission above the role ceiling', async () => {
    const gateway = createMockGateway();
    const result = await gateway.household.updatePermissionOverrides('member-hana', [{
      membershipId: 'member-hana', capability: 'expense.read', effect: 'allow',
    }], 1);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('creates a single-use 24-hour invite contract', async () => {
    const gateway = createMockGateway();
    const result = await gateway.household.createInvite('guest');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.remainingUses).toBe(1);
    expect(Date.parse(result.value.expiresAt) - Date.parse('2026-09-30T07:45:00+09:00')).toBe(86_400_000);
  });

  it('checks versions for events and todos', async () => {
    const gateway = createMockGateway();
    const event = await gateway.events.updateEvent('event-piano', 'this', { title: '更新' }, 99);
    expect(event).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const todo = await gateway.todos.updateTodo('todo-form', 'this', { title: '更新' }, 99);
    expect(todo).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('snoozes and stops only the requested notification', async () => {
    const gateway = createMockGateway();
    const snoozed = await gateway.notifications.snooze('notification-library', 30);
    expect(snoozed).toMatchObject({ ok: true, value: { status: 'snoozed', remindAt: '2026-09-30T18:00:00+09:00' } });
    const stopped = await gateway.notifications.stop('notification-library');
    expect(stopped).toMatchObject({ ok: true, value: { status: 'stopped' } });
    const resumed = await gateway.notifications.resume('notification-library');
    expect(resumed).toMatchObject({ ok: true, value: { status: 'active' } });
  });

  it('default-denies guest mutations and does not disclose unshared resources', async () => {
    const gateway = createMockGateway('member-yui');
    const created = await gateway.todos.createTodo({ title: '拒否対象', assigneeMembershipId: 'member-yui' });
    expect(created).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const snapshot = await gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.resources.map((item) => item.id)).toEqual(['resource-school', 'resource-guide']);
  });

  it('soft-deletes and restores only the requested record', async () => {
    const gateway = createMockGateway();
    expect(await gateway.events.deleteEvent('event-school', 'this', 1)).toEqual({ ok: true, value: undefined });
    const deleted = await gateway.household.getSnapshot();
    expect(deleted.ok && deleted.value.events.some((item) => item.id === 'event-school')).toBe(false);
    const restored = await gateway.events.restoreEvent('event-school');
    expect(restored).toMatchObject({ ok: true, value: { id: 'event-school', version: 2 } });
  });

  it('revokes invites and appends a settlement reversal instead of overwriting history', async () => {
    const gateway = createMockGateway();
    const invite = await gateway.household.createInvite('guest');
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;
    expect(await gateway.household.revokeInvite(invite.value.id)).toMatchObject({ ok: true, value: { remainingUses: 0 } });
    const reversed = await gateway.expenses.reverseSettlement('expense-groceries', 'settlement-1');
    expect(reversed.ok && reversed.value.settlements).toHaveLength(2);
    expect(reversed).toMatchObject({ ok: true, value: { settlements: [{ reversedAt: expect.any(String) }, { reversalOfSettlementId: 'settlement-1', amountJpy: -2920 }] } });
  });

  it('does not accept an invalid new password', async () => {
    const gateway = createMockGateway();
    const result = await gateway.auth.changePassword('current-password-long-enough', '123456789012345');
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});

describe('HTTP gateway', () => {
  it('treats 204 as success without attempting JSON parsing', async () => {
    const json = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true, headers: new Headers(), json });
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createHttpGateway('https://api.example.invalid', () => 'x'.repeat(32), () => 1);
    await expect(gateway.auth.signOut()).resolves.toEqual({ ok: true, value: undefined });
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ credentials: 'include', method: 'DELETE', headers: expect.objectContaining({ 'X-CSRF-Token': 'x'.repeat(32) }) }));
    vi.unstubAllGlobals();
  });

  it('sends idempotency and permission revision headers for queueable mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true, headers: new Headers(), json: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createHttpGateway('https://api.example.invalid', () => 'csrf-token', () => 5);
    await gateway.events.updateEvent('event-school', 'this', { title: '更新' }, 1, { idempotencyKey: 'operation-1', expectedPermissionRevision: 7 });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({ 'Idempotency-Key': 'operation-1', 'If-Permission-Revision': '7', 'X-CSRF-Token': 'csrf-token' }),
    }));
    vi.unstubAllGlobals();
  });
});
