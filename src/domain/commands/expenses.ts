import type { ExpensePort } from '../../data/gateway';
import { canDeleteResource, canSeeExpense, projectExpense } from '../../authz/policy';
import { hasActiveSettlement, splitShares } from '../ledger';
import { expenseInputSchema, expenseUpdateSchema, incomeCategorySchema } from '../schemas';
import type { Expense, ExpenseShare, Id, Result } from '../types';
import { applyPatch, archive, conflict, denied, invalid, missing, ok, fail } from './context';
import type { CommandContext, SyncPort } from './context';

export function createExpenseCommands(c: CommandContext): SyncPort<ExpensePort> {
  const { a, state, nextId, now, viewer, requireCapability, offlineFailure, placeWriteGuard, withinRestoreWindow, foreignMember, resolveVisibility } = c;
  const stakeholders = (item: Expense) => [item.creatorMembershipId, item.payerMembershipId];
  /** 一覧と同じ規則で、閲覧者に見える支出だけを探す。見えないものは、無いものと同じに扱う。 */
  const seen = (item: Expense | undefined): item is Expense => Boolean(item) && canSeeExpense(viewer(), item!);
  /** 応答は一覧と同じ投影を通す。見えない項目（場所など）は返さない。 */
  const shown = (item: Expense): Result<Expense> => { const projected = projectExpense(item, viewer()); return projected ? ok(projected) : missing('支出'); };
  /** 金額を指定した負担。支払った人の分は最初から精算済みとして扱う。 */
  const exactShares = (payer: Id, amounts: ReadonlyArray<{ membershipId: Id; amountJpy: number }>): ExpenseShare[] => amounts.map((item) => ({ membershipId: item.membershipId, amountJpy: item.amountJpy, settledJpy: item.membershipId === payer ? item.amountJpy : 0 }));
  return {
    createExpense(input) {
      const guard = requireCapability<Expense>('expense.create'); if (guard) return guard;
      const placeGuard = placeWriteGuard<Expense>(input.place); if (placeGuard) return placeGuard;
      const network = offlineFailure<Expense>(); if (network) return network;
      const parsed = expenseInputSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const data = parsed.data;
      const income = data.kind === 'income';
      const outsider = foreignMember<Expense>([data.payerMembershipId, ...(data.shareMembershipIds ?? []), ...(data.shareAmounts ?? []).map((item) => item.membershipId), ...(data.visibility?.selectedMembershipIds ?? [])]); if (outsider) return outsider;
      const visibility = data.visibility ? resolveVisibility(data.visibility, viewer().membershipId) : ok({ audience: 'household' as const, creatorMembershipId: viewer().membershipId, selectedMembershipIds: [] });
      if (!visibility.ok) return visibility;
      const expense: Expense = {
        id: nextId('expense'), householdId: state.household.id, kind: data.kind, title: data.title, amountJpy: data.amountJpy,
        incurredOn: data.incurredOn as Expense['incurredOn'], payerMembershipId: data.payerMembershipId, creatorMembershipId: viewer().membershipId,
        category: data.category ?? (income ? 'income_other' : 'other'), settlements: [],
        shares: income ? [] : data.shareAmounts ? exactShares(data.payerMembershipId, data.shareAmounts) : splitShares(data.amountJpy, data.payerMembershipId, data.shareMembershipIds ?? []),
        visibility: visibility.value, version: 1,
        ...(data.note ? { note: data.note } : {}), ...(data.place ? { place: data.place } : {}),
      };
      state.expenses = [expense, ...state.expenses];
      return shown(expense);
    },
    updateExpense(id, input, expectedVersion) {
      const guard = requireCapability<Expense>('expense.update'); if (guard) return guard;
      const target = state.expenses.find((item) => item.id === id && !item.deletedAt); if (!seen(target)) return missing('支出');
      const placeGuard = placeWriteGuard<Expense>(input.place); if (placeGuard) return placeGuard;
      const network = offlineFailure<Expense>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('支出');
      const parsed = expenseUpdateSchema.safeParse(input);
      if (!parsed.success) return invalid(parsed.error.issues);
      const { place, note, amountJpy, payerMembershipId, shareMembershipIds, shareAmounts, category, visibility: requested, ...rest } = parsed.data;
      const income = target.kind === 'income';
      const outsider = foreignMember<Expense>([payerMembershipId, ...(shareMembershipIds ?? []), ...(shareAmounts ?? []).map((item) => item.membershipId)]); if (outsider) return outsider;
      if (income && (shareMembershipIds || shareAmounts)) return invalid([{ message: '収入には負担を指定できません。' }]);
      if (category && incomeCategorySchema.safeParse(category).success !== income) return invalid([{ message: '費目を確認してください。' }]);
      const changesSplit = amountJpy !== undefined || payerMembershipId !== undefined || shareMembershipIds !== undefined || shareAmounts !== undefined;
      if (changesSplit && hasActiveSettlement(target)) return fail({ code: 'CONFLICT', message: '精算の記録があるため、金額・支払った人・負担する人は変更できません。先に精算を取り消してください。', retryable: false });
      if (shareAmounts && shareAmounts.reduce((sum, item) => sum + item.amountJpy, 0) !== (amountJpy ?? target.amountJpy)) return invalid([{ message: '負担の合計を金額と合わせてください。' }]);
      const visibility = requested ? resolveVisibility(requested, target.creatorMembershipId) : null;
      if (visibility && !visibility.ok) return visibility;
      // 変えた後も自分に見える範囲だけを選べる。見えなくなる変更は、結果を返せないので受け付けない。
      if (visibility?.ok && !canSeeExpense(viewer(), { ...target, visibility: visibility.value })) return invalid([{ message: 'この公開範囲にすると、あなたが見られなくなります。' }]);
      Object.assign(target, rest);
      if (category) target.category = category;
      if (visibility?.ok) target.visibility = visibility.value;
      if (changesSplit) {
        target.amountJpy = amountJpy ?? target.amountJpy;
        target.payerMembershipId = payerMembershipId ?? target.payerMembershipId;
        if (income) target.shares = [];
        else if (shareAmounts) target.shares = exactShares(target.payerMembershipId, shareAmounts);
        else target.shares = splitShares(target.amountJpy, target.payerMembershipId, shareMembershipIds ?? target.shares.map((share) => share.membershipId));
      }
      applyPatch(target, { note, place });
      target.version += 1;
      return shown(target);
    },
    deleteExpense(id, expectedVersion) {
      const guard = requireCapability<void>('expense.delete'); if (guard) return guard;
      const target = state.expenses.find((item) => item.id === id && !item.deletedAt); if (!seen(target)) return missing('支出');
      const decision = canDeleteResource(viewer(), 'expense.delete', stakeholders(target)); if (!decision.allowed) return denied(decision);
      const network = offlineFailure<void>(); if (network) return network;
      if (target.version !== expectedVersion) return conflict('支出');
      if (hasActiveSettlement(target)) return fail({ code: 'CONFLICT', message: '精算の記録がある支出は削除できません。先に精算を取り消してください。', retryable: false });
      target.deletedAt = now(); target.version += 1; archive(a.archives.expenses, id, structuredClone(target));
      return ok(undefined);
    },
    restoreExpense(id) {
      const guard = requireCapability<Expense>('expense.delete'); if (guard) return guard;
      const target = state.expenses.find((item) => item.id === id) ?? a.archives.expenses[id]; if (!seen(target) || !target.deletedAt) return missing('支出');
      const decision = canDeleteResource(viewer(), 'expense.delete', stakeholders(target)); if (!decision.allowed) return denied(decision);
      if (!withinRestoreWindow(target.deletedAt)) return fail({ code: 'CONFLICT', message: '削除から7日を過ぎたため、元に戻せません。', retryable: false });
      delete target.deletedAt; target.version += 1; delete a.archives.expenses[id];
      return shown(target);
    },
    recordSettlement(expenseId, fromMembershipId, amountJpy) {
      const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
      const network = offlineFailure<Expense>(); if (network) return network;
      const target = state.expenses.find((expense) => expense.id === expenseId && !expense.deletedAt);
      if (!seen(target)) return missing('支出');
      if (!Number.isInteger(amountJpy) || amountJpy <= 0) return invalid([{ message: '精算額は1円以上の整数にしてください。' }]);
      const share = target.shares.find((item) => item.membershipId === fromMembershipId && item.membershipId !== target.payerMembershipId);
      if (!share) return invalid([{ message: '精算する人を確認してください。' }]);
      if (share.settledJpy >= share.amountJpy) return fail({ code: 'CONFLICT', message: 'すでに精算済みです。', retryable: false });
      const applied = Math.min(amountJpy, share.amountJpy - share.settledJpy);
      share.settledJpy += applied;
      target.settlements.push({ id: nextId('settlement'), amountJpy: applied, fromMembershipId: share.membershipId, toMembershipId: target.payerMembershipId, recordedAt: now() });
      target.version += 1;
      return shown(target);
    },
    reverseSettlement(expenseId, settlementId) {
      const guard = requireCapability<Expense>('expense.settle'); if (guard) return guard;
      const network = offlineFailure<Expense>(); if (network) return network;
      const target = state.expenses.find((item) => item.id === expenseId && !item.deletedAt); if (!seen(target)) return missing('支出');
      const settlement = target.settlements.find((item) => item.id === settlementId && item.amountJpy > 0 && !item.reversedAt); if (!settlement) return missing('精算記録');
      const share = target.shares.find((item) => item.membershipId === settlement.fromMembershipId); if (!share) return missing('負担記録');
      const at = now();
      settlement.reversedAt = at; share.settledJpy = Math.max(0, share.settledJpy - settlement.amountJpy);
      target.settlements.push({ id: nextId('settlement-reversal'), amountJpy: -settlement.amountJpy, fromMembershipId: settlement.toMembershipId, toMembershipId: settlement.fromMembershipId, recordedAt: at, reversalOfSettlementId: settlement.id });
      target.version += 1;
      return shown(target);
    },
  };
}
