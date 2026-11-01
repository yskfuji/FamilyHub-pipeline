import type { ExpensePort } from '../../data/gateway';
import { hasActiveSettlement, splitShares } from '../ledger';
import { expenseInputSchema, expenseUpdateSchema } from '../schemas';
import type { Expense } from '../types';
import { archive, conflict, invalid, missing, ok, fail } from './context';
import type { CommandContext, SyncPort } from './context';

export function createExpenseCommands(c: CommandContext): SyncPort<ExpensePort> {
  const { a, state, nextId, now, requireCapability, offlineFailure, visible, placeWriteGuard, withinRestoreWindow, foreignMember } = c;
  return {
    createExpense(input) {
      const guard = requireCapability<Expense>('expense.create'); if (guard) return guard;
      const placeGuard = placeWriteGuard<Expense>(input.place); if (placeGuard) return placeGuard;
      const network = offlineFailure<Expense>(); if (network) return network;
      const parsed = expenseInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const data = parsed.data;
      const outsider = foreignMember<Expense>([data.payerMembershipId, ...data.shareMembershipIds]); if (outsider) return outsider;
      const expense: Expense = {
        id: nextId('expense'), householdId: state.household.id, title: data.title, amountJpy: data.amountJpy,
        incurredOn: data.incurredOn as Expense['incurredOn'], payerMembershipId: data.payerMembershipId, category: data.category, settlements: [],
        shares: splitShares(data.amountJpy, data.payerMembershipId, data.shareMembershipIds), version: 1,
        ...(data.note ? { note: data.note } : {}), ...(data.place ? { place: data.place } : {}),
      };
      state.expenses = [expense, ...state.expenses];
      return ok(visible(expense));
    },
    updateExpense(id, input, expectedVersion) {
      const guard = requireCapability<Expense>('expense.create'); if (guard) return guard;
      const target = state.expenses.find((item) => item.id === id && !item.deletedAt); if (!target) return missing('支出');
      const placeGuard = placeWriteGuard<Expense>(input.place); if (placeGuard) return placeGuard;
      const network = offlineFailure<Expense>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('支出');
      const parsed = expenseUpdateSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const { place, note, amountJpy, payerMembershipId, shareMembershipIds, ...rest } = parsed.data;
      const outsider = foreignMember<Expense>([payerMembershipId, ...(shareMembershipIds ?? [])]); if (outsider) return outsider;
      const changesSplit = amountJpy !== undefined || payerMembershipId !== undefined || shareMembershipIds !== undefined;
      if (changesSplit && hasActiveSettlement(target)) return fail({ code: 'CONFLICT', message: '精算の記録があるため、金額・支払った人・負担する人は変更できません。先に精算を取り消してください。', retryable: false });
      Object.assign(target, rest);
      if (changesSplit) {
        target.amountJpy = amountJpy ?? target.amountJpy;
        target.payerMembershipId = payerMembershipId ?? target.payerMembershipId;
        target.shares = splitShares(target.amountJpy, target.payerMembershipId, shareMembershipIds ?? target.shares.map((share) => share.membershipId));
      }
      if (note === null) delete target.note; else if (note !== undefined) target.note = note;
      if (place === null) delete target.place; else if (place) target.place = place;
      target.version += 1;
      return ok(visible(target));
    },
    deleteExpense(id, expectedVersion) {
      const guard = requireCapability<void>('expense.create'); if (guard) return guard;
      const target = state.expenses.find((item) => item.id === id && !item.deletedAt); if (!target) return missing('支出');
      const network = offlineFailure<void>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('支出');
      if (hasActiveSettlement(target)) return fail({ code: 'CONFLICT', message: '精算の記録がある支出は削除できません。先に精算を取り消してください。', retryable: false });
      target.deletedAt = now(); target.version += 1; archive(a.archives.expenses, id, structuredClone(target));
      return ok(undefined);
    },
    restoreExpense(id) {
      const guard = requireCapability<Expense>('expense.create'); if (guard) return guard;
      const target = state.expenses.find((item) => item.id === id) ?? a.archives.expenses[id]; if (!target?.deletedAt) return missing('支出');
      if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      delete target.deletedAt; target.version += 1; delete a.archives.expenses[id];
      return ok(visible(target));
    },
    recordSettlement(expenseId, fromMembershipId, amountJpy) {
      const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
      const network = offlineFailure<Expense>(); if (network) return network;
      const target = state.expenses.find((expense) => expense.id === expenseId && !expense.deletedAt);
      if (!target) return missing('支出');
      if (!Number.isInteger(amountJpy) || amountJpy <= 0) return invalid([{ message: '精算額は1円以上の整数にしてください。' }]);
      const share = target.shares.find((item) => item.membershipId === fromMembershipId && item.membershipId !== target.payerMembershipId);
      if (!share) return invalid([{ message: '精算する人を確認してください。' }]);
      if (share.settledJpy >= share.amountJpy) return fail({ code: 'CONFLICT', message: 'すでに精算済みです。', retryable: false });
      const applied = Math.min(amountJpy, share.amountJpy - share.settledJpy);
      share.settledJpy += applied;
      target.settlements.push({ id: nextId('settlement'), amountJpy: applied, fromMembershipId: share.membershipId, toMembershipId: target.payerMembershipId, recordedAt: now() });
      target.version += 1;
      return ok(visible(target));
    },
    reverseSettlement(expenseId, settlementId) {
      const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
      const network = offlineFailure<Expense>(); if (network) return network;
      const target = state.expenses.find((item) => item.id === expenseId && !item.deletedAt); if (!target) return missing('支出');
      const settlement = target.settlements.find((item) => item.id === settlementId && item.amountJpy > 0 && !item.reversedAt); if (!settlement) return missing('精算記録');
      const share = target.shares.find((item) => item.membershipId === settlement.fromMembershipId); if (!share) return missing('負担記録');
      const at = now();
      settlement.reversedAt = at; share.settledJpy = Math.max(0, share.settledJpy - settlement.amountJpy);
      target.settlements.push({ id: nextId('settlement-reversal'), amountJpy: -settlement.amountJpy, fromMembershipId: settlement.toMembershipId, toMembershipId: settlement.fromMembershipId, recordedAt: at, reversalOfSettlementId: settlement.id });
      target.version += 1;
      return ok(visible(target));
    },
  };
}
