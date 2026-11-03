// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EncryptedOfflineQueue, MemoryQueuePersistence, queueableOperations } from './queue';

describe('encrypted offline queue', () => {
  it('round-trips an eligible command without exposing plaintext in persistence', async () => {
    const persistence = new MemoryQueuePersistence();
    const queue = new EncryptedOfflineQueue(persistence, () => 1_000);
    await queue.enqueue({ operation: 'memo.create', summary: '学校のメモ', payload: { input: { title: '秘密', body: '本文', tags: [] } } }, { actorUserId: 'user-aoi', householdId: 'house-mori', permissionRevision: 1 });
    expect(JSON.stringify(await persistence.load())).not.toContain('秘密');
    expect(await queue.list()).toMatchObject([{ operation: 'memo.create', summary: '学校のメモ', payload: { input: { title: '秘密' } } }]);
  });

  it('expires records after 24 hours and enforces the allowlist', async () => {
    let now = 1_000;
    const queue = new EncryptedOfflineQueue(new MemoryQueuePersistence(), () => now);
    await queue.enqueue({ operation: 'task.create', summary: 'タスク', payload: { input: { title: '確認', assigneeMembershipId: 'member-aoi' } } }, { actorUserId: 'user-aoi', householdId: 'house-mori', permissionRevision: 1 });
    now += 86_400_001;
    expect(await queue.list()).toEqual([]);
    expect([...queueableOperations]).not.toContain('expense.create');
  });

  it('never queues a change of an expense, a kind change or a settlement, and keeps queueing series edits with their version (A3-7, A4-8, A13-7)', async () => {
    expect([...queueableOperations].filter((operation) => /^(expense|settlement|budget)/.test(operation))).toEqual([]);
    const queue = new EncryptedOfflineQueue(new MemoryQueuePersistence(), () => 1_000);
    await expect(queue.enqueue({ operation: 'expense.update', summary: '種類を変更', payload: {} } as never, { actorUserId: 'user-aoi', householdId: 'house-mori', permissionRevision: 1 })).rejects.toThrow();
    await queue.enqueue({ operation: 'event.update', summary: '予定', payload: { id: 'event-clean', scope: 'series', input: { startsAt: '2026-10-02T08:00:00+09:00', endsAt: '2026-10-02T08:30:00+09:00' }, expectedVersion: 1 } }, { actorUserId: 'user-aoi', householdId: 'house-mori', permissionRevision: 1 });
    expect(await queue.list()).toMatchObject([{ operation: 'event.update', payload: { scope: 'series', expectedVersion: 1 } }]);
  });

  it('limits storage to 50 changes and keeps account metadata authenticated', async () => {
    const persistence = new MemoryQueuePersistence();
    const queue = new EncryptedOfflineQueue(persistence, () => 1_000);
    const context = { actorUserId: 'user-aoi', householdId: 'house-mori', permissionRevision: 3 };
    for (let index = 0; index < 50; index += 1) {
      await queue.enqueue({ operation: 'memo.create', summary: `メモ${index}`, payload: { input: { title: `題${index}`, body: '本文', tags: [] } } }, context);
    }
    await expect(queue.enqueue({ operation: 'memo.create', summary: '上限超過', payload: { input: { title: '超過', body: '本文', tags: [] } } }, context)).rejects.toThrow('50件');
    expect(await queue.list()).toEqual(expect.arrayContaining([expect.objectContaining({ actorUserId: 'user-aoi', householdId: 'house-mori', permissionRevision: 3 })]));
  });
});
