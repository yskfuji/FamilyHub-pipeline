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
    expect(restored).toMatchObject({ ok: true, value: { id: 'event-school', version: 3 } });
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

describe('mock gateway recurrence, expenses, invites and notifications', () => {
  const occurrences = async (gateway: ReturnType<typeof createMockGateway>, id: string) => {
    const snapshot = await gateway.household.getSnapshot();
    return snapshot.ok ? snapshot.value.events.filter((event) => event.id === id || event.title === '資源回収') : [];
  };

  it('deletes only the chosen occurrence of a recurring event and can restore it', async () => {
    const gateway = createMockGateway();
    expect(await gateway.events.deleteEvent('event-clean', 'this', 1)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await gateway.events.deleteEvent('event-clean', 'this', 1, '2026-10-08')).toEqual({ ok: true, value: undefined });
    const [series] = await occurrences(gateway, 'event-clean');
    expect(series.recurrence?.exceptions).toEqual(['2026-10-08']);
    expect(series.deletedAt).toBeUndefined();
    const restored = await gateway.events.restoreEvent('event-clean');
    expect(restored.ok && restored.value.recurrence?.exceptions).toEqual([]);
  });

  it('splits a series for "this and following" edits and keeps earlier occurrences unchanged', async () => {
    const gateway = createMockGateway();
    const result = await gateway.events.updateEvent('event-clean', 'future', { title: '資源回収（新しい時間）', startsAt: '2026-10-15T09:00:00+09:00', endsAt: '2026-10-15T09:30:00+09:00' }, 1, undefined, '2026-10-15');
    expect(result).toMatchObject({ ok: true, value: { title: '資源回収（新しい時間）', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH' } } });
    const snapshot = await gateway.household.getSnapshot();
    const original = snapshot.ok ? snapshot.value.events.find((event) => event.id === 'event-clean') : undefined;
    expect(original?.recurrence?.rrule).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261014');
    expect(original?.title).toBe('資源回収');
  });

  it('detaches a single occurrence for "this event only" edits', async () => {
    const gateway = createMockGateway();
    const result = await gateway.events.updateEvent('event-clean', 'this', { title: '資源回収（祝日のため変更）' }, 1, undefined, '2026-10-08');
    expect(result.ok && result.value.recurrence).toBeUndefined();
    expect(result.ok && result.value.startsAt).toBe('2026-10-08T08:00:00+09:00');
  });

  it('advances a recurring task to the next occurrence when it is completed or skipped', async () => {
    const gateway = createMockGateway();
    const done = await gateway.todos.updateTodoStatus('todo-garbage', 'done', 1);
    expect(done).toMatchObject({ ok: true, value: { status: 'done', title: '資源ごみをまとめる' } });
    let snapshot = await gateway.household.getSnapshot();
    const series = snapshot.ok ? snapshot.value.todos.find((todo) => todo.id === 'todo-garbage') : undefined;
    expect(series).toMatchObject({ status: 'open', dueAt: '2026-10-08T07:30:00+09:00' });
    expect(await gateway.todos.deleteTodo('todo-garbage', series!.version, 'this')).toEqual({ ok: true, value: undefined });
    snapshot = await gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.todos.find((todo) => todo.id === 'todo-garbage')?.dueAt).toBe('2026-10-15T07:30:00+09:00');
  });

  it('refuses to send a task for review when nobody reviews it', async () => {
    const gateway = createMockGateway();
    expect(await gateway.todos.updateTodoStatus('todo-library', 'review', 1)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('splits odd amounts without leaving an unsettlable yen and settles a specific person', async () => {
    const gateway = createMockGateway();
    const created = await gateway.expenses.createExpense({ title: 'お菓子', amountJpy: 1001, incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', shareMembershipIds: ['member-aoi', 'member-ren'], category: 'food' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.shares).toEqual([{ membershipId: 'member-aoi', amountJpy: 501, settledJpy: 501 }, { membershipId: 'member-ren', amountJpy: 500, settledJpy: 0 }]);
    const settled = await gateway.expenses.recordSettlement(created.value.id, 'member-ren', 500);
    expect(settled.ok && settled.value.shares.every((share) => share.settledJpy === share.amountJpy)).toBe(true);
  });

  it('locks the split after a settlement, blocks deletion, and restores deleted expenses', async () => {
    const gateway = createMockGateway();
    const settled = await gateway.expenses.recordSettlement('expense-books', 'member-ren', 1430);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(await gateway.expenses.updateExpense('expense-books', { amountJpy: 3000 }, settled.value.version)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const renamed = await gateway.expenses.updateExpense('expense-books', { title: '学校教材（図工）', note: null }, settled.value.version);
    expect(renamed).toMatchObject({ ok: true, value: { title: '学校教材（図工）' } });
    expect(renamed.ok && 'note' in renamed.value).toBe(false);
    expect(await gateway.expenses.deleteExpense('expense-books', renamed.ok ? renamed.value.version : 0)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const record = settled.value.settlements.at(-1)!;
    const reversed = await gateway.expenses.reverseSettlement('expense-books', record.id);
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    expect(await gateway.expenses.deleteExpense('expense-books', reversed.value.version)).toEqual({ ok: true, value: undefined });
    let snapshot = await gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.expenses.some((expense) => expense.id === 'expense-books')).toBe(false);
    expect(await gateway.expenses.restoreExpense('expense-books')).toMatchObject({ ok: true, value: { id: 'expense-books' } });
    snapshot = await gateway.household.getSnapshot();
    expect(snapshot.ok && snapshot.value.expenses.some((expense) => expense.id === 'expense-books')).toBe(true);
  });

  it('accepts a valid invite once and rejects unknown, used, or revoked codes alike', async () => {
    const gateway = createMockGateway();
    expect(await gateway.household.acceptInvite('FAMILY-2026-DEMO-0001')).toMatchObject({ ok: true });
    const reused = await gateway.household.acceptInvite('FAMILY-2026-DEMO-0001');
    const unknown = await gateway.household.acceptInvite('NOT-A-CODE');
    expect(reused).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(unknown.ok === false && reused.ok === false && unknown.error.message === reused.error.message).toBe(true);
  });

  it('filters notifications by preferences and moves night reminders to the morning', async () => {
    const gateway = createMockGateway();
    await gateway.notifications.updatePreferences({ todoDue: false });
    const list = await gateway.notifications.list();
    expect(list.ok && list.value.map((item) => item.kind)).toEqual(['eventDeparture']);
    expect(await gateway.notifications.updatePreferences({ unknown: true } as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('guards insights, notification preferences and household profile by capability', async () => {
    expect(await createMockGateway('member-hana').insights.list()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await createMockGateway('member-ren').household.updateProfile({ name: '森家' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const owner = createMockGateway();
    expect(await owner.household.updateProfile({ name: '森家' })).toMatchObject({ ok: true, value: { name: '森家' } });
    const insights = await owner.insights.list();
    expect(insights.ok && insights.value.map((item) => item.id)).toContain('insight-unsettled');
  });

  it('completes passkey sign-in only for the issued challenge', async () => {
    const gateway = createMockGateway();
    const begun = await gateway.auth.beginPasskey();
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(await gateway.auth.finishPasskey('other', { demo: true })).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(await gateway.auth.finishPasskey(begun.value.challengeId, { demo: true })).toMatchObject({ ok: true });
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
