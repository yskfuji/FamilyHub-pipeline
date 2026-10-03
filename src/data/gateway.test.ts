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

describe('mock gateway places and privacy', () => {
  const place = { name: '三軒茶屋の文具店', address: '東京都世田谷区太子堂', coordinates: { lat: 35.64371, lng: 139.6703 }, provenance: { provider: 'openpoi' as const, source: 'overture', licenses: ['CDLA-Permissive-2.0'], attributions: ['Overture Maps Foundation, overturemaps.org'] }, capturedVia: 'device' as const, selectedAt: '2026-10-03T12:00:00+09:00' };

  it('rejects place writes from viewers who cannot read places', async () => {
    const gateway = createMockGateway('member-hana');
    expect(await gateway.memos.createMemo({ title: '宿題', body: '音読', tags: [], place })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const created = await gateway.memos.createMemo({ title: '宿題', body: '音読', tags: [] });
    expect(created.ok).toBe(true);
  });

  it('stores, clears, and validates memo places', async () => {
    const gateway = createMockGateway();
    const created = await gateway.memos.createMemo({ title: '買い物', body: 'ノート', tags: [], place });
    expect(created).toMatchObject({ ok: true, value: { place: { name: '三軒茶屋の文具店' } } });
    if (!created.ok) return;
    const cleared = await gateway.memos.updateMemo(created.value.id, { place: null }, created.value.version);
    expect(cleared.ok && cleared.value.place).toBeFalsy();
    const invalid = await gateway.memos.updateMemo(created.value.id, { place: { ...place, accuracy: 12 } as never }, created.value.version + 1);
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('validates expenses and keeps the chosen place', async () => {
    const gateway = createMockGateway();
    expect(await gateway.expenses.createExpense({ title: '', amountJpy: 100, incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', shareMembershipIds: ['member-aoi'] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const created = await gateway.expenses.createExpense({ title: 'ノート', amountJpy: 480, incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', shareMembershipIds: ['member-aoi', 'member-ren'], place });
    expect(created).toMatchObject({ ok: true, value: { place: { name: '三軒茶屋の文具店' } } });
  });

  it('removes places from mutation results for viewers without place access', async () => {
    const owner = createMockGateway();
    const ownerView = await owner.memos.updateMemo('memo-school', { title: '学校公開のお知らせ（更新）' }, 1);
    expect(ownerView).toMatchObject({ ok: true, value: { place: { name: '青葉小学校 体育館' } } });
    const child = createMockGateway('member-hana');
    const childMemo = await child.memos.createMemo({ title: 'メモ', body: '本文', tags: [] });
    expect(childMemo.ok && 'place' in childMemo.value).toBe(false);
  });

  it('stamps consent time on the receiving side and keeps it until the notice changes', async () => {
    const gateway = createMockGateway();
    expect(await gateway.household.getPrivacySettings()).toMatchObject({ ok: true, value: { placeLookupConsent: null } });
    const granted = await gateway.household.savePrivacySettings({ defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: { noticeVersion: '2026-10-03', grantedAt: '1999-01-01T00:00:00+09:00' } });
    expect(granted).toMatchObject({ ok: true, value: { placeLookupConsent: { noticeVersion: '2026-10-03', grantedAt: '2026-09-30T07:45:00+09:00' } } });
    const revoked = await gateway.household.savePrivacySettings({ defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null });
    expect(revoked).toMatchObject({ ok: true, value: { placeLookupConsent: null } });
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

  it('reads privacy settings with a plain GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = createHttpGateway('https://api.example.test', () => 'csrf', () => 1);
    expect(await gateway.household.getPrivacySettings()).toMatchObject({ ok: true, value: { placeLookupConsent: null } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://api.example.test/v1/households/current/privacy');
    expect(init.method ?? 'GET').toBe('GET');
    vi.unstubAllGlobals();
  });
});
