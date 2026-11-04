import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextOn } from './readableText';

describe('readableTextOn', () => {
  it('keeps at least 4.5:1 on every colour, including the hardest middle greys', () => {
    for (let value = 0; value < 256; value += 1) {
      for (const hex of [value.toString(16).padStart(2, '0').repeat(3), `${value.toString(16).padStart(2, '0')}8040`, `40${value.toString(16).padStart(2, '0')}80`]) {
        const background = `#${hex}`;
        expect(contrastRatio(readableTextOn(background), background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('puts white on the sample family colours and black on light ones', () => {
    for (const color of ['#315c80', '#a94f38', '#6f7552', '#8a6680', '#796a55']) expect(readableTextOn(color)).toBe('#ffffff');
    expect(readableTextOn('#f2c25c')).toBe('#000000');
  });
});
