import { parseYen } from './expenseForm';

/** 精算額の確認。問題があれば文言を返す。残りの額を超える金額は受け付けない。 */
export function settlementAmountProblem(text: string, remainingJpy: number, yen: (value: number) => string): string | null {
  const amountJpy = parseYen(text);
  if (!amountJpy) return '精算額は1円以上の整数で入力してください。';
  return amountJpy > remainingJpy ? `精算額は残りの${yen(remainingJpy)}以下にしてください。` : null;
}

export type SettlementPreset = { kind: 'full' | 'half'; amountJpy: number };

/** すぐに選べる額。1円の残りは半分にできない。 */
export function settlementPresets(remainingJpy: number): SettlementPreset[] {
  const half = Math.floor(remainingJpy / 2);
  return [{ kind: 'full', amountJpy: remainingJpy }, ...(half > 0 ? [{ kind: 'half' as const, amountJpy: half }] : [])];
}
