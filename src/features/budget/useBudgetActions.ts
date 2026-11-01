import { useRef, useState } from 'react';
import { memberName, useApp } from '../../app/AppContext';
import { formatYen } from '../../design-system/components';
import type { SettlementHistoryEntry } from '../../domain/ledger';
import type { ExpenseUpdateInput } from '../../domain/schemas';
import type { Expense, Result } from '../../domain/types';

export type BudgetUndo = { kind: 'settlement'; entry: SettlementHistoryEntry; amountJpy: number } | { kind: 'deleted'; expense: Expense };

export interface ExpenseActions {
  /** 失敗したときは文言を返す。入力は画面に残す。 */
  settle(expense: Expense, fromMembershipId: string, amountJpy: number): Promise<string | null>;
  reverse(entry: SettlementHistoryEntry): Promise<void>;
  update(expense: Expense, input: ExpenseUpdateInput): Promise<string | null>;
  remove(expense: Expense): Promise<void>;
  busy: string | null;
}

/** 記録を変える操作。同時に1つだけ動かす（お金の記録を二重にしないため）。 */
export function useBudgetActions(onDeleted: () => void) {
  const { snapshot, gateway, refresh, announce } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [undo, setUndo] = useState<BudgetUndo | null>(null);
  const running = useRef(false);

  const run = async <T,>(key: string, operation: () => Promise<Result<T>>, onSuccess: (value: T) => void) => {
    if (running.current) return '前の操作を処理しています。終わってからもう一度お試しください。';
    running.current = true;
    setBusy(key);
    try {
      const result = await operation();
      if (!result.ok) return result.error.message;
      onSuccess(result.value);
      await refresh();
      return null;
    } finally {
      running.current = false;
      setBusy(null);
    }
  };
  const report = async (outcome: Promise<string | null>) => { const message = await outcome; if (message) announce(message); };

  const actions: ExpenseActions = {
    busy,
    settle: (expense, fromMembershipId, amountJpy) => run(`settle:${expense.id}`, () => gateway.expenses.recordSettlement(expense.id, fromMembershipId, amountJpy), (updated) => {
      const record = updated.settlements.at(-1);
      if (!record) return;
      setUndo({ kind: 'settlement', entry: { expenseId: updated.id, expenseTitle: updated.title, record, canReverse: true }, amountJpy: record.amountJpy });
      const adjusted = record.amountJpy < amountJpy ? '残りの額が変わっていたため、残りの分だけ記録しました。' : '';
      announce(`${memberName(snapshot, fromMembershipId)}さんの${formatYen(record.amountJpy)}の精算を記録しました。${adjusted}精算の履歴から取り消せます。`);
    }),
    reverse: (entry) => report(run(entry.record.id, () => gateway.expenses.reverseSettlement(entry.expenseId, entry.record.id), () => {
      if (undo?.kind === 'settlement' && undo.entry.record.id === entry.record.id) setUndo(null);
      announce(`${formatYen(entry.record.amountJpy)}の精算を取り消しました。元の記録と取り消しの記録は履歴に残ります。`);
    })),
    update: (expense, input) => run(`update:${expense.id}`, () => gateway.expenses.updateExpense(expense.id, input, expense.version), () => announce(`${expense.kind === 'income' ? '収入' : '支出'}を更新しました。`)),
    remove: (expense) => report(run(`delete:${expense.id}`, () => gateway.expenses.deleteExpense(expense.id, expense.version), () => {
      setUndo({ kind: 'deleted', expense });
      onDeleted();
      announce(`「${expense.title}」を削除しました。7日以内なら元に戻せます。`);
    })),
  };
  const restore = (expense: Expense) => report(run(`restore:${expense.id}`, () => gateway.expenses.restoreExpense(expense.id), (value) => {
    setUndo(null);
    announce(`「${value.title}」を元に戻しました。`);
  }));
  return { actions, undo, restore };
}
