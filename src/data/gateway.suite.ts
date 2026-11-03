import { describe, expect, it } from 'vitest';
import type { FamilyHubGateway } from './gateway';

/** 確認用の実装と API の実装の両方に流す試験。world は呼ぶたびに、見本の家族を持つ新しい環境を返す。 */
export function runGatewaySuite(world: (actorMembershipId?: string) => FamilyHubGateway) {
  describe('gateway state transitions', () => {
    it('protects the sole owner and checks membership versions', async () => {
      const gateway = world();
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
      const gateway = world();
      const result = await gateway.household.updatePermissionOverrides('member-hana', [{
        membershipId: 'member-hana', capability: 'expense.read', effect: 'allow',
      }], 1);
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('creates a single-use 24-hour invite contract', async () => {
      const gateway = world();
      const result = await gateway.household.createInvite('guest');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.remainingUses).toBe(1);
      expect(Date.parse(result.value.expiresAt) - Date.parse('2026-09-30T07:45:00+09:00')).toBe(86_400_000);
    });

    it('keeps the length of a recurring task with a range when it moves to the next occurrence', async () => {
      const gateway = world();
      const created = await gateway.todos.createTodo({ title: '期間', assigneeMembershipId: 'member-aoi', dueStartAt: '2026-10-05T09:00:00+09:00', dueAt: '2026-10-07T18:00:00+09:00', recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'Asia/Tokyo', exceptions: [] } });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect((await gateway.todos.updateTodoStatus(created.value.id, 'done', 1)).ok).toBe(true);
      const after = await gateway.household.getSnapshot();
      const series = after.ok ? after.value.todos.find((todo) => todo.id === created.value.id) : undefined;
      expect(series).toMatchObject({ dueStartAt: '2026-10-12T09:00:00+09:00', dueAt: '2026-10-14T18:00:00+09:00', status: 'open' });
    });

    it('checks versions for events and todos', async () => {
      const gateway = world();
      const event = await gateway.events.updateEvent('event-school', 'this', { title: '更新' }, 99);
      expect(event).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      const todo = await gateway.todos.updateTodo('todo-form', 'this', { title: '更新' }, 99);
      expect(todo).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    });

    it('answers NOT_FOUND for records the viewer cannot see, so existence is not disclosed', async () => {
      const owner = world();
      const hidden = await owner.events.updateEvent('event-piano', 'this', { title: '更新' }, 1);
      expect(hidden).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      const absent = await owner.events.updateEvent('event-unknown', 'this', { title: '更新' }, 1);
      expect(hidden.ok === false && absent.ok === false && hidden.error.message === absent.error.message).toBe(true);
      expect(await world('member-hana').todos.deleteTodo('todo-done', 3)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(await world('member-hana').memos.deleteMemo('memo-clinic')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });

    it('answers NOT_FOUND for every change to an expense the viewer cannot see, even when the viewer pays or shares it', async () => {
      const owner = world();
      const same = async (hidden: Promise<{ ok: boolean }>, absent: Promise<{ ok: boolean }>) => {
        const [a, b] = await Promise.all([hidden, absent]);
        expect(a).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
        expect(a).toEqual(b);
      };
      await same(owner.expenses.recordSettlement('expense-ren-private', 'member-aoi', 100), owner.expenses.recordSettlement('expense-unknown', 'member-aoi', 100));
      await same(owner.expenses.reverseSettlement('expense-ren-private', 'settlement-private'), owner.expenses.reverseSettlement('expense-unknown', 'settlement-private'));
      await same(owner.expenses.updateExpense('expense-ren-private', { title: '書き換え' }, 1), owner.expenses.updateExpense('expense-unknown', { title: '書き換え' }, 1));
      await same(owner.expenses.deleteExpense('expense-ren-private', 1), owner.expenses.deleteExpense('expense-unknown', 1));
      await same(owner.expenses.restoreExpense('expense-ren-deleted'), owner.expenses.restoreExpense('expense-unknown'));
      const trash = await owner.trash.list();
      expect(trash.ok && trash.value.map((item) => item.id)).not.toContain('expense-ren-deleted');
      // 見える人には、同じ操作が通る。
      const adult = world('member-ren');
      expect(await adult.expenses.recordSettlement('expense-ren-private', 'member-aoi', 100)).toMatchObject({ ok: true, value: { id: 'expense-ren-private', shares: [{ membershipId: 'member-aoi', settledJpy: 600 }, { membershipId: 'member-ren' }] } });
      expect(await adult.expenses.restoreExpense('expense-ren-deleted')).toMatchObject({ ok: true, value: { id: 'expense-ren-deleted' } });
    });

    it('refuses an expense audience that would hide the record from the person changing it', async () => {
      const owner = world();
      expect(await owner.expenses.updateExpense('expense-august-utilities', { visibility: { audience: 'creator' } }, 1)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      const snapshot = await owner.household.getSnapshot();
      expect(snapshot.ok && snapshot.value.expenses.find((item) => item.id === 'expense-august-utilities')?.visibility.audience).toBe('household');
    });

    it('lets an owner promote only a declared adult, and lets one of two owners leave', async () => {
      const owner = world();
      const guest = await owner.household.updateMembershipRole('member-yui', 'adult', 1);
      expect(guest).toMatchObject({ ok: true, value: { role: 'adult' } });
      expect(await owner.household.updateMembershipRole('member-yui', 'owner', 2)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await owner.family.transferOwnership('member-yui', 2)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await owner.household.updateMembershipRole('member-ren', 'owner', 1)).toMatchObject({ ok: true, value: { role: 'owner' } });
      expect(await owner.family.leaveHousehold()).toEqual({ ok: true, value: undefined });
    });

    it('refuses people from outside the household in every written reference', async () => {
      const gateway = world();
      expect(await gateway.todos.createTodo({ title: '外の人', assigneeMembershipId: 'member-other' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.todos.updateTodo('todo-form', 'series', { reviewerMembershipId: 'member-other' }, 2)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.events.createEvent({ title: '外の人', startsAt: '2026-10-05T09:00:00+09:00', endsAt: '2026-10-05T10:00:00+09:00', timezone: 'Asia/Tokyo', participantMembershipIds: ['member-other'] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.expenses.createExpense({ title: '外の人', amountJpy: 100, incurredOn: '2026-09-30', payerMembershipId: 'member-other', shareMembershipIds: ['member-aoi'] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('keeps the length of multi-day occurrences when detaching one', async () => {
      const gateway = world();
      const created = await gateway.events.createEvent({ title: '合宿', startsAt: '2026-10-05T09:00:00+09:00', endsAt: '2026-10-07T17:00:00+09:00', timezone: 'Asia/Tokyo', participantMembershipIds: ['member-aoi'], recurrence: { rrule: 'FREQ=WEEKLY', timezone: 'Asia/Tokyo', exceptions: [] } });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const single = await gateway.events.updateEvent(created.value.id, 'this', { title: '合宿（延期）' }, 1, undefined, '2026-10-12');
      expect(single).toMatchObject({ ok: true, value: { startsAt: '2026-10-12T09:00:00+09:00', endsAt: '2026-10-14T17:00:00+09:00' } });
    });

    it('lets only stakeholders delete, even when the viewer is the owner', async () => {
      const owner = world();
      expect(await owner.todos.deleteTodo('todo-done', 3)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', reason: 'SCOPE_DENIED' } });
      const adult = world('member-ren');
      expect(await adult.events.deleteEvent('event-school', 'series', 1)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(await adult.expenses.deleteExpense('expense-books', 1)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', reason: 'SCOPE_DENIED' } });
    });

    it('honors a chosen audience and refuses wide audiences for children', async () => {
      const child = world('member-hana');
      expect(await child.memos.createMemo({ title: 'メモ', body: '本文', tags: [], visibility: { audience: 'household' } })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await child.memos.createMemo({ title: 'メモ', body: '本文', tags: [], visibility: { audience: 'selected', selectedMembershipIds: ['member-aoi'] } })).toMatchObject({ ok: true, value: { visibility: { audience: 'selected', creatorMembershipId: 'member-hana', selectedMembershipIds: ['member-aoi'] } } });
      const owner = world();
      expect(await owner.memos.createMemo({ title: 'メモ', body: '本文', tags: [], visibility: { audience: 'selected' } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('clears optional event and task fields with null and refuses unknown lists', async () => {
      const gateway = world();
      const cleared = await gateway.events.updateEvent('event-school', 'series', { note: null, location: null }, 1);
      expect(cleared.ok && 'note' in cleared.value).toBe(false);
      expect(await gateway.events.updateEvent('event-school', 'series', { colorLabelId: 'label-other' }, 2)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      const task = await gateway.todos.updateTodo('todo-form', 'series', { dueAt: null, priority: 'high', colorLabelId: 'label-home' }, 2);
      expect(task).toMatchObject({ ok: true, value: { priority: 'high', colorLabelId: 'label-home' } });
      expect(task.ok && 'dueAt' in task.value).toBe(false);
      expect(await gateway.todos.createTodo({ title: '順序', assigneeMembershipId: 'member-aoi', dueStartAt: '2026-10-05T10:00:00+09:00', dueAt: '2026-10-05T09:00:00+09:00' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('keeps one-line comments on hand-off and completion', async () => {
      const gateway = world();
      const waiting = await gateway.todos.updateTodoStatus('todo-library', 'waiting', 1, '返却の窓口が開くまで');
      expect(waiting).toMatchObject({ ok: true, value: { status: 'waiting', handoffNote: '返却の窓口が開くまで' } });
      if (!waiting.ok) return;
      expect(await gateway.todos.updateTodoStatus('todo-library', 'done', waiting.value.version, '返しました')).toMatchObject({ ok: true, value: { status: 'done', completionNote: '返しました' } });
    });

    it('records income without shares and accepts exact split amounts', async () => {
      const gateway = world();
      const income = await gateway.expenses.createExpense({ title: '給与', amountJpy: 300000, incurredOn: '2026-09-25', payerMembershipId: 'member-aoi', kind: 'income', category: 'income_salary' });
      expect(income).toMatchObject({ ok: true, value: { kind: 'income', shares: [] } });
      expect(await gateway.expenses.createExpense({ title: '給与', amountJpy: 300000, incurredOn: '2026-09-25', payerMembershipId: 'member-aoi', kind: 'income', category: 'food' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.expenses.createExpense({ title: '合計違い', amountJpy: 1000, incurredOn: '2026-09-25', payerMembershipId: 'member-aoi', shareAmounts: [{ membershipId: 'member-ren', amountJpy: 900 }] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      const exact = await gateway.expenses.createExpense({ title: '指定', amountJpy: 1000, incurredOn: '2026-09-25', payerMembershipId: 'member-aoi', shareAmounts: [{ membershipId: 'member-aoi', amountJpy: 300 }, { membershipId: 'member-ren', amountJpy: 700 }] });
      expect(exact).toMatchObject({ ok: true, value: { shares: [{ membershipId: 'member-aoi', amountJpy: 300, settledJpy: 300 }, { membershipId: 'member-ren', amountJpy: 700, settledJpy: 0 }] } });
    });

    it('hides links whose other end the viewer cannot see', async () => {
      const owner = await world().household.getSnapshot();
      expect(owner.ok && owner.value.links.map((link) => link.id)).toEqual(['link-school']);
      const guest = await world('member-yui').household.getSnapshot();
      expect(guest.ok && guest.value.links).toEqual([]);
    });

    it('refuses a recurrence the calendar cannot expand', async () => {
      const gateway = world();
      expect(await gateway.events.createEvent({ title: '年1回', startsAt: '2026-10-05T09:00:00+09:00', endsAt: '2026-10-05T10:00:00+09:00', timezone: 'Asia/Tokyo', participantMembershipIds: ['member-aoi'], recurrence: { rrule: 'FREQ=YEARLY', timezone: 'Asia/Tokyo', exceptions: [] } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('answers NOT_FOUND for an unknown notification', async () => {
      expect(await world().notifications.markRead('notification-unknown')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });

    it('snoozes and stops only the requested notification', async () => {
      const gateway = world();
      const snoozed = await gateway.notifications.snooze('notification-library', 30);
      expect(snoozed).toMatchObject({ ok: true, value: { status: 'snoozed', remindAt: '2026-09-30T18:00:00+09:00' } });
      const stopped = await gateway.notifications.stop('notification-library');
      expect(stopped).toMatchObject({ ok: true, value: { status: 'stopped' } });
      const resumed = await gateway.notifications.resume('notification-library');
      expect(resumed).toMatchObject({ ok: true, value: { status: 'active' } });
    });

    it('default-denies guest mutations and does not disclose unshared resources', async () => {
      const gateway = world('member-yui');
      const created = await gateway.todos.createTodo({ title: '拒否対象', assigneeMembershipId: 'member-yui' });
      expect(created).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const snapshot = await gateway.household.getSnapshot();
      expect(snapshot.ok && snapshot.value.resources.map((item) => item.id)).toEqual(['resource-school', 'resource-guide']);
    });

    it('soft-deletes and restores only the requested record', async () => {
      const gateway = world();
      expect(await gateway.events.deleteEvent('event-school', 'this', 1)).toEqual({ ok: true, value: undefined });
      const deleted = await gateway.household.getSnapshot();
      expect(deleted.ok && deleted.value.events.some((item) => item.id === 'event-school')).toBe(false);
      const restored = await gateway.events.restoreEvent('event-school');
      expect(restored).toMatchObject({ ok: true, value: { id: 'event-school', version: 3 } });
    });

    it('revokes invites and appends a settlement reversal instead of overwriting history', async () => {
      const gateway = world();
      const invite = await gateway.household.createInvite('guest');
      expect(invite.ok).toBe(true);
      if (!invite.ok) return;
      expect(await gateway.household.revokeInvite(invite.value.id)).toMatchObject({ ok: true, value: { remainingUses: 0 } });
      const reversed = await gateway.expenses.reverseSettlement('expense-groceries', 'settlement-1');
      expect(reversed.ok && reversed.value.settlements).toHaveLength(2);
      expect(reversed).toMatchObject({ ok: true, value: { settlements: [{ reversedAt: expect.any(String) }, { reversalOfSettlementId: 'settlement-1', amountJpy: -2920 }] } });
    });

    it('does not accept an invalid new password', async () => {
      const gateway = world();
      const result = await gateway.auth.changePassword('current-password-long-enough', '123456789012345');
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('refuses common, personal and patterned new passwords everywhere and accepts a passphrase (A9)', async () => {
      const gateway = world();
      // 一覧の見本（全件は passwordPolicy.test.ts）、表示名・家族の名前・サービス名、並び。
      for (const value of ['manchesterunited', 'TransportOnline', '1q2w3e4r5t6y7u8i9o0p', 'qazwsxedcrfvtgb', '碧1234567890123456', '森さんち2026!!!!!!!!!', 'yoridokoro2026!!!!!', 'zzzzzzzzzzzzzzzz']) {
        expect(await gateway.auth.changePassword('current-password-long-enough', value)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      }
      expect(await gateway.auth.confirmPasswordReset({ token: 'not-a-real-token', newPassword: 'manchesterunited' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      const person = { displayName: '山田 花子', email: 'hanako.yamada@example.test', birthdate: '1990-04-01' };
      expect(await gateway.auth.signUp({ ...person, password: 'manchesterunited' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.auth.signUp({ ...person, password: 'Hanako.Yamada-1990-04-01' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.auth.signUp({ ...person, password: '山田花子1990!!!!!!!!' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.auth.changePassword('current-password-long-enough', 'みかんの木の下で猫が三匹ねむる')).toEqual({ ok: true, value: undefined });
    });
  });

  describe('gateway places and privacy', () => {
    const place = { name: '三軒茶屋の文具店', address: '東京都世田谷区太子堂', coordinates: { lat: 35.64371, lng: 139.6703 }, provenance: { provider: 'openpoi' as const, source: 'overture', licenses: ['CDLA-Permissive-2.0'], attributions: ['Overture Maps Foundation, overturemaps.org'] }, capturedVia: 'device' as const, selectedAt: '2026-10-03T12:00:00+09:00' };

    it('rejects place writes from viewers who cannot read places', async () => {
      const gateway = world('member-hana');
      expect(await gateway.memos.createMemo({ title: '宿題', body: '音読', tags: [], place })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const created = await gateway.memos.createMemo({ title: '宿題', body: '音読', tags: [] });
      expect(created.ok).toBe(true);
    });

    it('stores, clears, and validates memo places', async () => {
      const gateway = world();
      const created = await gateway.memos.createMemo({ title: '買い物', body: 'ノート', tags: [], place });
      expect(created).toMatchObject({ ok: true, value: { place: { name: '三軒茶屋の文具店' } } });
      if (!created.ok) return;
      const cleared = await gateway.memos.updateMemo(created.value.id, { place: null }, created.value.version);
      expect(cleared.ok && cleared.value.place).toBeFalsy();
      const invalid = await gateway.memos.updateMemo(created.value.id, { place: { ...place, accuracy: 12 } as never }, created.value.version + 1);
      expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('validates expenses and keeps the chosen place', async () => {
      const gateway = world();
      expect(await gateway.expenses.createExpense({ title: '', amountJpy: 100, incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', shareMembershipIds: ['member-aoi'] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      const created = await gateway.expenses.createExpense({ title: 'ノート', amountJpy: 480, incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', shareMembershipIds: ['member-aoi', 'member-ren'], place });
      expect(created).toMatchObject({ ok: true, value: { place: { name: '三軒茶屋の文具店' } } });
    });

    it('removes places from mutation results for viewers without place access', async () => {
      const owner = world();
      const ownerView = await owner.memos.updateMemo('memo-school', { title: '学校公開のお知らせ（更新）' }, 1);
      expect(ownerView).toMatchObject({ ok: true, value: { place: { name: '青葉小学校 体育館' } } });
      const child = world('member-hana');
      const childMemo = await child.memos.createMemo({ title: 'メモ', body: '本文', tags: [] });
      expect(childMemo.ok && 'place' in childMemo.value).toBe(false);
    });

    it('stamps consent time on the receiving side and keeps it until the notice changes', async () => {
      const gateway = world();
      expect(await gateway.household.getPrivacySettings()).toMatchObject({ ok: true, value: { placeLookupConsent: null } });
      const granted = await gateway.household.savePrivacySettings({ defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: { noticeVersion: '2026-10-03', grantedAt: '1999-01-01T00:00:00+09:00' } });
      expect(granted).toMatchObject({ ok: true, value: { placeLookupConsent: { noticeVersion: '2026-10-03', grantedAt: '2026-09-30T07:45:00+09:00' } } });
      const revoked = await gateway.household.savePrivacySettings({ defaultAudience: 'household', hideNotificationContent: true, placeLookupConsent: null });
      expect(revoked).toMatchObject({ ok: true, value: { placeLookupConsent: null } });
    });
  });

  describe('gateway recurrence, expenses, invites and notifications', () => {
    const occurrences = async (gateway: FamilyHubGateway, id: string) => {
      const snapshot = await gateway.household.getSnapshot();
      return snapshot.ok ? snapshot.value.events.filter((event) => event.id === id || event.title === '資源回収') : [];
    };

    it('deletes only the chosen occurrence of a recurring event and can restore it', async () => {
      const gateway = world();
      expect(await gateway.events.deleteEvent('event-clean', 'this', 1)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.events.deleteEvent('event-clean', 'this', 1, '2026-10-08')).toEqual({ ok: true, value: undefined });
      const [series] = await occurrences(gateway, 'event-clean');
      expect(series.recurrence?.exceptions).toEqual(['2026-10-08']);
      expect(series.deletedAt).toBeUndefined();
      const restored = await gateway.events.restoreEvent('event-clean');
      expect(restored.ok && restored.value.recurrence?.exceptions).toEqual([]);
    });

    it('splits a series for "this and following" edits and keeps earlier occurrences unchanged', async () => {
      const gateway = world();
      const result = await gateway.events.updateEvent('event-clean', 'future', { title: '資源回収（新しい時間）', startsAt: '2026-10-15T09:00:00+09:00', endsAt: '2026-10-15T09:30:00+09:00' }, 1, undefined, '2026-10-15');
      expect(result).toMatchObject({ ok: true, value: { title: '資源回収（新しい時間）', recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH' } } });
      const snapshot = await gateway.household.getSnapshot();
      const original = snapshot.ok ? snapshot.value.events.find((event) => event.id === 'event-clean') : undefined;
      expect(original?.recurrence?.rrule).toBe('FREQ=WEEKLY;BYDAY=TH;UNTIL=20261014');
      expect(original?.title).toBe('資源回収');
    });

    it('detaches a single occurrence for "this event only" edits', async () => {
      const gateway = world();
      const result = await gateway.events.updateEvent('event-clean', 'this', { title: '資源回収（祝日のため変更）' }, 1, undefined, '2026-10-08');
      expect(result.ok && result.value.recurrence).toBeUndefined();
      expect(result.ok && result.value.startsAt).toBe('2026-10-08T08:00:00+09:00');
    });

    it('advances a recurring task to the next occurrence when it is completed or skipped', async () => {
      const gateway = world();
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
      const gateway = world();
      expect(await gateway.todos.updateTodoStatus('todo-library', 'review', 1)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('splits odd amounts without leaving an unsettlable yen and settles a specific person', async () => {
      const gateway = world();
      const created = await gateway.expenses.createExpense({ title: 'お菓子', amountJpy: 1001, incurredOn: '2026-09-30', payerMembershipId: 'member-aoi', shareMembershipIds: ['member-aoi', 'member-ren'], category: 'food' });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.shares).toEqual([{ membershipId: 'member-aoi', amountJpy: 501, settledJpy: 501 }, { membershipId: 'member-ren', amountJpy: 500, settledJpy: 0 }]);
      const settled = await gateway.expenses.recordSettlement(created.value.id, 'member-ren', 500);
      expect(settled.ok && settled.value.shares.every((share) => share.settledJpy === share.amountJpy)).toBe(true);
    });

    it('locks the split after a settlement, blocks deletion, and restores deleted expenses', async () => {
      const gateway = world();
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
      const gateway = world();
      expect(await gateway.household.acceptInvite('FAMILY-2026-DEMO-0001')).toMatchObject({ ok: true });
      const reused = await gateway.household.acceptInvite('FAMILY-2026-DEMO-0001');
      const unknown = await gateway.household.acceptInvite('NOT-A-CODE');
      expect(reused).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
      expect(unknown.ok === false && reused.ok === false && unknown.error.message === reused.error.message).toBe(true);
    });

    it('filters notifications by preferences and moves night reminders to the morning', async () => {
      const gateway = world();
      await gateway.notifications.updatePreferences({ todoDue: false });
      const list = await gateway.notifications.list();
      expect(list.ok && list.value.map((item) => item.kind)).toEqual(['eventDeparture']);
      expect(await gateway.notifications.updatePreferences({ unknown: true } as never)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('guards insights, notification preferences and household profile by capability', async () => {
      expect(await world('member-hana').insights.list()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await world('member-ren').household.updateProfile({ name: '森家' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      const owner = world();
      expect(await owner.household.updateProfile({ name: '森家' })).toMatchObject({ ok: true, value: { name: '森家' } });
      const insights = await owner.insights.list();
      expect(insights.ok && insights.value.map((item) => item.id)).toContain('insight-unsettled');
    });

  });

  describe('gateway family, links and recently deleted', () => {
    it('reports a build identifier without signing in the caller again', async () => {
      const result = await world().auth.getVersion();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.build).toEqual(expect.any(String));
    });

    it('keeps the household rename history visible and stops at three a day', async () => {
      const gateway = world();
      for (const name of ['一回目の名前', '二回目の名前', '三回目の名前']) expect((await gateway.household.updateProfile({ name })).ok).toBe(true);
      const snapshot = await gateway.household.getSnapshot();
      expect(snapshot.ok && snapshot.value.household.nameChanges).toHaveLength(3);
      expect(await gateway.household.updateProfile({ name: '四回目の名前' })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    });

    it('hands ownership to an adult and refuses a child', async () => {
      const gateway = world();
      expect(await gateway.family.transferOwnership('member-hana', 1)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.family.transferOwnership('member-ren', 1)).toMatchObject({ ok: true, value: { role: 'owner' } });
      const snapshot = await gateway.household.getSnapshot();
      expect(snapshot.ok && snapshot.value.viewer.role).toBe('adult');
      expect(snapshot.ok && snapshot.value.viewer.capabilities).not.toContain('household.members.manage');
    });

    it('suspends and removes members, but not the owner or oneself', async () => {
      const gateway = world();
      expect(await gateway.family.setMemberStatus('member-aoi', 'suspended', 1)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await gateway.family.setMemberStatus('member-yui', 'suspended', 1)).toMatchObject({ ok: true, value: { status: 'suspended' } });
      expect(await gateway.family.removeMember('member-yui', 2)).toEqual({ ok: true, value: undefined });
      expect(await gateway.family.removeMember('member-yui', 3)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(await world('member-ren').family.removeMember('member-yui', 1)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    });

    it('keeps the sole owner from leaving', async () => {
      expect(await world().family.leaveHousehold()).toMatchObject({ ok: false, error: { reason: 'OWNER_REQUIRED' } });
      expect(await world('member-ren').family.leaveHousehold()).toEqual({ ok: true, value: undefined });
    });

    it('limits household renames to three a day', async () => {
      const gateway = world();
      for (const name of ['一', '二', '三']) expect((await gateway.household.updateProfile({ name })).ok).toBe(true);
      expect(await gateway.household.updateProfile({ name: '四' })).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    });

    it('manages color lists and clears them from records when deleted', async () => {
      const gateway = world();
      const label = await gateway.family.createColorLabel({ name: '旅行', color: '#336699' });
      expect(label.ok).toBe(true);
      if (!label.ok) return;
      await gateway.events.updateEvent('event-school', 'series', { colorLabelId: label.value.id }, 1);
      expect(await gateway.family.deleteColorLabel(label.value.id)).toEqual({ ok: true, value: undefined });
      const snapshot = await gateway.household.getSnapshot();
      expect(snapshot.ok && snapshot.value.events.find((item) => item.id === 'event-school')?.colorLabelId).toBeUndefined();
    });

    it('links visible records only and hides that an unseen record exists', async () => {
      const gateway = world();
      const created = await gateway.links.createLink({ kind: 'task', id: 'todo-form' }, { kind: 'expense', id: 'expense-books' });
      expect(created.ok).toBe(true);
      expect(await gateway.links.createLink({ kind: 'task', id: 'todo-form' }, { kind: 'expense', id: 'expense-books' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(await gateway.links.createLink({ kind: 'task', id: 'todo-form' }, { kind: 'event', id: 'event-piano' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
      expect(await world('member-hana').links.createLink({ kind: 'event', id: 'event-school' }, { kind: 'task', id: 'todo-practice' })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      if (created.ok) expect(await gateway.links.deleteLink(created.value.id)).toEqual({ ok: true, value: undefined });
    });

    it('lists what the viewer may restore, including a single occurrence', async () => {
      const gateway = world();
      await gateway.memos.deleteMemo('memo-receipt');
      await gateway.events.deleteEvent('event-clean', 'this', 1, '2026-10-08');
      const trash = await gateway.trash.list();
      expect(trash.ok && trash.value.map((item) => [item.kind, item.id])).toEqual(expect.arrayContaining([['memo', 'memo-receipt'], ['occurrence', 'event-clean']]));
      expect(await gateway.events.restoreEvent('event-clean', '2026-10-08')).toMatchObject({ ok: true, value: { recurrence: { exceptions: [] } } });
      const after = await gateway.trash.list();
      expect(after.ok && after.value.some((item) => item.kind === 'occurrence')).toBe(false);
    });

    it('shows albums to whoever may see them and keeps them out of the snapshot', async () => {
      const owner = world();
      const albums = await owner.albums.listAlbums();
      expect(albums.ok && albums.value.map((item) => item.id).sort()).toEqual(['album-park', 'album-sports']);
      const created = await owner.albums.createAlbum({ title: '夏休み', visibility: { audience: 'creator' } });
      expect(created.ok).toBe(true);
      const child = await world('member-hana').albums.listAlbums();
      expect(child.ok && child.value.map((item) => item.id)).toEqual(['album-sports']);
      const snapshot = await owner.household.getSnapshot();
      expect(snapshot.ok && 'albums' in snapshot.value).toBe(false);
      if (!created.ok) return;
      expect(await owner.albums.deleteAlbum(created.value.id, 1)).toEqual({ ok: true, value: undefined });
      expect(await owner.albums.restoreAlbum(created.value.id)).toMatchObject({ ok: true });
    });

    const onePixel = () => new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (character) => character.charCodeAt(0))], 'reading.png', { type: 'image/png' });
    const finished = async (gateway: FamilyHubGateway, id: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const job = await gateway.assistant.getJob(id);
        if (!job.ok || job.value.status === 'done' || job.value.status === 'failed') return job;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('reading did not finish');
    };

    it('offers reading helpers to adults and hides them from a child', async () => {
      expect(await world().assistant.getStatus()).toMatchObject({ ok: true, value: { available: true } });
      expect(await world('member-ren').assistant.getStatus()).toMatchObject({ ok: true, value: { available: true } });
      expect(await world('member-hana').assistant.getStatus()).toMatchObject({ ok: true, value: { available: false } });
      expect(await world('member-hana').assistant.readReceipt(onePixel())).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', reason: 'CAPABILITY_MISSING' } });
      expect(await world('member-hana').assistant.readEventUrl('https://example.com/event')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    });

    it('turns a receipt into a proposal and saves nothing', async () => {
      const gateway = world();
      const before = await gateway.household.getSnapshot();
      const started = await gateway.assistant.readReceipt(onePixel());
      expect(started).toMatchObject({ ok: true, value: { kind: 'receipt' } });
      if (!started.ok) return;
      const job = await finished(gateway, started.value.id);
      expect(job).toMatchObject({ ok: true, value: { status: 'done', receipt: { amountJpy: 2480, category: 'food' } } });
      const after = await gateway.household.getSnapshot();
      expect(after.ok && before.ok && after.value.expenses.length).toBe(before.ok ? before.value.expenses.length : 0);
    });

    it('turns a flyer or a page into candidates and saves nothing', async () => {
      const gateway = world();
      const before = await gateway.household.getSnapshot();
      for (const start of [() => gateway.assistant.readEventImage(onePixel()), () => gateway.assistant.readEventUrl('https://example.com/event?utm_source=mail')]) {
        const started = await start();
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const job = await finished(gateway, started.value.id);
        expect(job.ok && job.value.events?.length).toBeGreaterThan(0);
        expect(job.ok && job.value.events?.[0]).toMatchObject({ date: '2026-10-27', startTime: '10:00', allDay: false });
      }
      const after = await gateway.household.getSnapshot();
      expect(after.ok && before.ok && after.value.events.length).toBe(before.ok ? before.value.events.length : 0);
    });

    it('refuses a file that is not an image and a URL that is not https', async () => {
      const gateway = world();
      expect(await gateway.assistant.readReceipt(new File(['hello'], 'note.png', { type: 'image/png' }))).toMatchObject({ ok: false, error: { code: 'ATTACHMENT_REJECTED' } });
      expect(await gateway.assistant.readEventUrl('http://example.com/')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.assistant.getJob('reading-unknown')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });

    it('reorders items and refuses a partial order', async () => {
      const gateway = world();
      expect(await gateway.albums.reorderItems('album-sports', ['item-sports-1'], 1)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect((await gateway.albums.reorderItems('album-sports', ['item-sports-3', 'item-sports-1', 'item-sports-2'], 1)).ok).toBe(true);
      const album = await gateway.albums.getAlbum('album-sports');
      expect(album.ok && album.value.items.map((item) => item.id)).toEqual(['item-sports-3', 'item-sports-1', 'item-sports-2']);
      expect(await gateway.albums.deleteItem('album-sports', 'item-sports-3')).toEqual({ ok: true, value: undefined });
      expect(await gateway.albums.restoreItem('album-sports', 'item-sports-3')).toMatchObject({ ok: true });
    });
  });

  describe('change record (A5)', () => {
    const itemKeys = ['action', 'actor', 'at', 'detail', 'group', 'id', 'target'];

    it('records each successful change once by operation name, with field names but never the values', async () => {
      const gateway = world();
      const secret = '合言葉はひみつのりんご';
      expect((await gateway.todos.createTodo({ title: '', assigneeMembershipId: 'member-aoi' })).ok).toBe(false);
      const todo = await gateway.todos.createTodo({ title: secret, assigneeMembershipId: 'member-aoi' });
      expect((await gateway.expenses.updateExpense('expense-books', { title: secret, note: secret }, 1)).ok).toBe(true);
      const page = await gateway.audit.list();
      expect(page.ok && todo.ok).toBe(true);
      if (!page.ok || !todo.ok) return;
      expect(page.value.items.map((item) => [item.action, item.group, item.target, item.detail])).toEqual([
        ['updateExpense', 'expenses', { kind: 'expense', id: 'expense-books', hidden: false }, { fields: ['note', 'title'] }],
        ['createTodo', 'tasks', { kind: 'task', id: todo.value.id, hidden: false }, null],
      ]);
      for (const item of page.value.items) {
        expect(Object.keys(item).sort()).toEqual(itemKeys);
        expect(item.actor).toEqual({ kind: 'member', membershipId: 'member-aoi', displayName: '碧' });
      }
      expect(JSON.stringify(page.value)).not.toContain(secret);
      expect(page.value).toMatchObject({ nextCursor: null, chain: { state: 'ok' } });
    });

    it('lets only owners read the household record, and every member read their own account record', async () => {
      expect(await world('member-ren').audit.list()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN', reason: 'CAPABILITY_MISSING' } });
      expect(await world('member-hana').audit.list()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
      expect(await world('member-ren').audit.listMine()).toEqual({ ok: true, value: { items: [], nextCursor: null } });
      const owner = world();
      expect((await owner.auth.updateAccount({ idleTimeoutMinutes: 5 })).ok).toBe(true);
      const mine = await owner.audit.listMine();
      expect(mine.ok && mine.value.items.map((item) => ({ ...item, id: 'id', at: 'at' }))).toEqual([{ id: 'id', at: 'at', actor: { kind: 'self' }, action: 'updateAccount', group: 'account', detail: { fields: ['idleTimeoutMinutes'] } }]);
      const household = await owner.audit.list();
      expect(household.ok && household.value.items).toEqual([]);
    });

    it('filters by person, kind and date, and pages with a cursor', async () => {
      const gateway = world();
      for (const title of ['一', '二', '三']) expect((await gateway.todos.createTodo({ title, assigneeMembershipId: 'member-aoi' })).ok).toBe(true);
      expect((await gateway.events.createEvent({ title: '記録', startsAt: '2026-10-05T09:00:00+09:00', endsAt: '2026-10-05T10:00:00+09:00', timezone: 'Asia/Tokyo', participantMembershipIds: ['member-aoi'] })).ok).toBe(true);
      const first = await gateway.audit.list({ group: 'tasks', limit: 2 });
      expect(first.ok && first.value.items.map((item) => item.action)).toEqual(['createTodo', 'createTodo']);
      if (!first.ok || !first.value.nextCursor) throw new Error('expected a second page');
      const second = await gateway.audit.list({ group: 'tasks', limit: 2, cursor: first.value.nextCursor });
      expect(second.ok && [second.value.items.map((item) => item.action), second.value.nextCursor]).toEqual([['createTodo'], null]);
      const count = async (query: Parameters<FamilyHubGateway['audit']['list']>[0]) => { const page = await gateway.audit.list(query); return page.ok ? page.value.items.length : -1; };
      expect(await count({ action: 'createEvent' })).toBe(1);
      expect(await count({ group: 'tasks', action: 'createEvent' })).toBe(0);
      expect(await count({ membershipId: 'member-aoi' })).toBe(4);
      expect(await count({ membershipId: 'member-ren' })).toBe(0);
      expect(await count({ from: '2026-09-30', to: '2026-09-30' })).toBe(4);
      expect(await count({ from: '2026-10-01' })).toBe(0);
      expect(await gateway.audit.list({ membershipId: 'member-other' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(await gateway.audit.list({ limit: 500 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    });

    it('hides the ID of a record the viewer can no longer see', async () => {
      const gateway = world();
      const link = await gateway.links.createLink({ kind: 'task', id: 'todo-form' }, { kind: 'expense', id: 'expense-books' });
      expect(link.ok).toBe(true);
      if (!link.ok) return;
      const visible = await gateway.audit.list();
      expect(visible.ok && visible.value.items[0].target).toEqual({ kind: 'link', id: link.value.id, hidden: false });
      expect((await gateway.links.deleteLink(link.value.id)).ok).toBe(true);
      const hidden = await gateway.audit.list();
      expect(hidden.ok && hidden.value.items.map((item) => [item.action, item.target])).toEqual([
        ['deleteItemLink', { kind: 'link', id: null, hidden: true }],
        ['createItemLink', { kind: 'link', id: null, hidden: true }],
      ]);
      expect(JSON.stringify(hidden)).not.toContain(link.value.id);
    });
  });
}
