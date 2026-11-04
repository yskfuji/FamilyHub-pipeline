import { describe, expect, it } from 'vitest';
import { divergingScale, lengthScale, percent, roundPosition } from './scale';

describe('chart scales', () => {
  it('starts bars at zero and gives the largest value the full length', () => {
    const scale = lengthScale([5840, 3360, 2860]);
    expect(scale(5840)).toBe(100);
    expect(scale(2920)).toBe(50);
    expect(scale(0)).toBe(0);
    // 最小の値から始めない: 3360 と 2860 の差は小さいまま。
    expect(scale(3360) - scale(2860)).toBeCloseTo((500 / 5840) * 100, 1);
  });

  it('keeps lengths proportional to values', () => {
    const scale = lengthScale([100, 25, 50]);
    expect(scale(50) / scale(25)).toBe(2);
  });

  it('draws nothing when every value is zero, and never a negative length', () => {
    const scale = lengthScale([0, 0]);
    expect(scale(0)).toBe(0);
    expect(lengthScale([10])(-5)).toBe(0);
    expect(lengthScale([])(3)).toBe(0);
  });

  it('centres the diverging scale on zero and sends negative values left', () => {
    const scale = divergingScale([1680, -1430, -250]);
    expect(scale(1680)).toEqual({ x: 50, width: 50 });
    expect(scale(-1680)).toEqual({ x: 0, width: 50 });
    expect(scale(-840)).toEqual({ x: 25, width: 25 });
    expect(scale(0)).toEqual({ x: 50, width: 0 });
    const left = scale(-1430);
    expect(left.x + left.width).toBe(50);
  });

  it('uses the largest absolute value on either side for both halves', () => {
    const scale = divergingScale([-200, 100]);
    expect(scale(-200).width).toBe(50);
    expect(scale(100).width).toBe(25);
    expect(divergingScale([0, 0])(0)).toEqual({ x: 50, width: 0 });
  });

  it('rounds label and bar positions to a hundredth of a percent', () => {
    expect(roundPosition(33.333333)).toBe(33.33);
    expect(roundPosition(66.666666)).toBe(66.67);
    expect(lengthScale([3])(1)).toBe(33.33);
    expect(divergingScale([-3, 1])(1)).toEqual({ x: 50, width: 16.67 });
    expect(divergingScale([-3, 1])(-2)).toEqual({ x: 16.67, width: 33.33 });
    expect(percent(12.3456)).toBe('12.35%');
  });
});
