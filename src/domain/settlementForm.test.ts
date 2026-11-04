import { describe, expect, it } from 'vitest';
import { settlementAmountProblem, settlementPresets } from './settlementForm';

const yen = (value: number) => `${value}円`;

describe('settlement amount', () => {
  it('accepts any whole amount up to the remainder', () => {
    expect(settlementAmountProblem('1', 1430, yen)).toBeNull();
    expect(settlementAmountProblem('１，４３０', 1430, yen)).toBeNull();
  });

  it('refuses amounts over the remainder and says what the limit is', () => {
    expect(settlementAmountProblem('1431', 1430, yen)).toBe('精算額は残りの1430円以下にしてください。');
  });

  it('refuses empty, zero and fractional amounts', () => {
    for (const text of ['', '0', '1.5', '-1']) expect(settlementAmountProblem(text, 1430, yen)).toContain('1円以上の整数');
  });

  it('offers the whole remainder and half of it, rounded down', () => {
    expect(settlementPresets(1431)).toEqual([{ kind: 'full', amountJpy: 1431 }, { kind: 'half', amountJpy: 715 }]);
  });

  it('offers only the remainder when one yen is left', () => {
    expect(settlementPresets(1)).toEqual([{ kind: 'full', amountJpy: 1 }]);
  });
});
