import { describe, expect, it } from 'vitest';
import { sumMoney } from './money';

describe('sumMoney', () => {
  it('adds exactly, without float drift', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(['100000.00', '2500.5', '7'])).toBe('102507.50');
  });

  it('handles an empty list and negatives', () => {
    expect(sumMoney([])).toBe('0.00');
    expect(sumMoney(['10.00', '-12.50'])).toBe('-2.50');
  });

  it('rejects values that are not money', () => {
    expect(() => sumMoney(['abc'])).toThrow();
    expect(() => sumMoney(['1.234'])).toThrow();
  });
});
