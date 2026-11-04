import { describe, expect, it } from 'vitest';
import { projectSnapshotForViewer } from '../../authz/policy';
import { initialAggregate } from '../../data/mockGateway';
import { netBalances, openShares, settleAllRequest, splitShares, transfersSettle } from '../ledger';
import type { Expense, HouseholdMembership } from '../types';
import { createHouseholdRules } from './index';
import type { HouseholdAggregate } from './context';

/** 試験を同じ順で繰り返せるように、種から作る乱数（mulberry32）。 */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const rulesFor = (aggregate: HouseholdAggregate, actorMembershipId: string) => {
  let sequence = 0;
  return createHouseholdRules(aggregate, { actorMembershipId, now: () => '2026-10-01T09:00:00+09:00', nextId: (prefix) => `${prefix}-test-${++sequence}`, newInviteToken: () => 'token' });
};

describe('settling everything at once (A4, property, seeded)', () => {
  it('balances sum to zero, needs at most n-1 transfers, settles every included share to zero, and a reversal restores every remaining amount', () => {
    const next = random(4_2026);
    const pick = (count: number) => Math.floor(next() * count);
    let nonEmpty = 0;
    for (let round = 0; round < 250; round += 1) {
      const aggregate = initialAggregate();
      const size = 2 + pick(6);
      const extra: HouseholdMembership[] = Array.from({ length: size }, (_, index) => ({ id: `member-p${index}`, householdId: 'house-mori', userId: `user-p${index}`, displayName: `P${index}`, role: 'adult', status: 'active', color: '#315c80', version: 1 }));
      aggregate.state.memberships = [...aggregate.state.memberships.filter((member) => member.id === 'member-aoi'), ...extra];
      const people = ['member-aoi', ...extra.map((member) => member.id)];
      aggregate.state.expenses = Array.from({ length: pick(12) }, (_, index): Expense => {
        const payer = people[pick(people.length)];
        const sharers = people.filter(() => next() < 0.6);
        const ids = sharers.length ? sharers : [people[pick(people.length)]];
        const amountJpy = 1 + pick(30_000);
        const shares = splitShares(amountJpy, payer, ids).map((share) => share.membershipId === payer || next() < 0.7 ? share : { ...share, settledJpy: pick(share.amountJpy + 1) });
        return { id: `expense-r${index}`, householdId: 'house-mori', kind: 'expense', title: `記録${index}`, amountJpy, incurredOn: '2026-09-30', payerMembershipId: payer, creatorMembershipId: 'member-aoi', category: 'other', shares, settlements: [], visibility: { audience: 'household', creatorMembershipId: 'member-aoi', selectedMembershipIds: [] }, version: 1 };
      });
      const rules = rulesFor(aggregate, 'member-aoi');
      const visible = rules.context.project();
      const before = openShares(visible.expenses);
      const request = settleAllRequest(visible.expenses, { memberFilterActive: false });
      if (!before.length) { expect(request).toBeNull(); continue; }
      nonEmpty += 1;
      const balances = netBalances(before);
      expect([...balances.values()].reduce((sum, value) => sum + value, 0)).toBe(0);
      const parties = [...balances.values()].filter((value) => value !== 0).length;
      expect(request!.transfers.length).toBeLessThanOrEqual(Math.max(0, parties - 1));
      expect(transfersSettle(balances, request!.transfers)).toBe(true);
      const settled = rules.expenses.settleAll(request!);
      expect(settled.ok).toBe(true);
      if (!settled.ok) return;
      for (const item of request!.shares) {
        const share = aggregate.state.expenses.find((expense) => expense.id === item.expenseId)!.shares.find((entry) => entry.membershipId === item.membershipId)!;
        expect(share.amountJpy - share.settledJpy).toBe(0);
      }
      expect(openShares(aggregate.state.expenses)).toEqual([]);
      expect(rules.expenses.reverseBatch(settled.value.id).ok).toBe(true);
      expect(openShares(aggregate.state.expenses)).toEqual(before);
    }
    expect(nonEmpty).toBeGreaterThan(150);
  });

  it('shows a batch only to people who can see every expense in it', () => {
    const aggregate = initialAggregate();
    const ren = rulesFor(aggregate, 'member-ren');
    const snapshot = ren.context.project();
    const settled = ren.expenses.settleAll(settleAllRequest(snapshot.expenses, { memberFilterActive: false })!);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(ren.context.project().settlementBatches.map((batch) => batch.id)).toEqual([settled.value.id]);
    // 碧さんには蓮さんだけの支出が見えないので、その支出を含むまとめは見えず、取り消しもできない。
    const aoi = rulesFor(aggregate, 'member-aoi');
    expect(aoi.context.project().settlementBatches).toEqual([]);
    expect(aoi.expenses.reverseBatch(settled.value.id)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(projectSnapshotForViewer({ ...aggregate.state, permissionOverrides: [] }, aoi.context.viewer()).settlementBatches).toEqual([]);
    expect(projectSnapshotForViewer({ ...aggregate.state, permissionOverrides: [] }, ren.context.viewer()).settlementBatches).toHaveLength(1);
  });

  it('builds no request while the list is filtered by a member, or when nothing is left', () => {
    const aggregate = initialAggregate();
    expect(settleAllRequest(aggregate.state.expenses, { memberFilterActive: true })).toBeNull();
    expect(settleAllRequest([], { memberFilterActive: false })).toBeNull();
  });
});

describe('the settlement history groups a batch into one row (A4-4)', () => {
  it('shows a batch and its reversal as one row each, and offers the whole reversal only while no part was reversed on its own', async () => {
    const { groupedSettlementHistory } = await import('../ledger');
    const aggregate = initialAggregate();
    const rules = rulesFor(aggregate, 'member-ren');
    const visible = () => aggregate.state.expenses.filter((expense) => !expense.deletedAt);
    const request = settleAllRequest(visible(), { memberFilterActive: false });
    expect(request).not.toBeNull();
    const settled = rules.expenses.settleAll(request!);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    let rows = groupedSettlementHistory(visible(), aggregate.state.settlementBatches);
    const batchRows = rows.filter((row) => row.kind === 'batch');
    expect(batchRows).toHaveLength(1);
    const [batch] = batchRows;
    if (batch.kind !== 'batch') return;
    expect(batch.entries).toHaveLength(request!.shares.length);
    expect(batch.totalJpy).toBe(request!.shares.reduce((sum, share) => sum + share.remainingJpy, 0));
    expect(batch.transfers).toEqual(request!.transfers);
    expect(batch.canReverse).toBe(true);
    // 前からある記録ごとの精算は、そのまま1件ずつ並ぶ。
    expect(rows.some((row) => row.kind === 'single' && row.entry.record.id === 'settlement-1')).toBe(true);

    // 一部を個別に取り消すと、まとめごとの取り消しは出さない。
    const part = batch.entries[0];
    expect(rules.expenses.reverseSettlement(part.expenseId, part.record.id).ok).toBe(true);
    rows = groupedSettlementHistory(visible(), aggregate.state.settlementBatches);
    const partly = rows.find((row) => row.kind === 'batch' && !row.reversal);
    expect(partly).toMatchObject({ kind: 'batch', partlyReversed: true, canReverse: false });

    // 取り消しの記録は、まとめにも記録ごとにも数えない。まとめた精算をもう一度作り、まとめごと取り消す。
    const again = settleAllRequest(visible(), { memberFilterActive: false });
    const second = rules.expenses.settleAll(again!);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(rules.expenses.reverseBatch(second.value.id).ok).toBe(true);
    rows = groupedSettlementHistory(visible(), aggregate.state.settlementBatches);
    const ofSecond = rows.filter((row) => row.kind === 'batch' && row.batchId === second.value.id);
    // 時計を止めているので、並びではなく中身で確かめる。
    const original = ofSecond.find((row) => row.kind === 'batch' && !row.reversal);
    const reversal = ofSecond.find((row) => row.kind === 'batch' && row.reversal);
    expect(ofSecond).toHaveLength(2);
    expect(original).toMatchObject({ reversed: true, canReverse: false, partlyReversed: false });
    expect(reversal).toMatchObject({ totalJpy: (original as { totalJpy: number }).totalJpy });
  });
});
