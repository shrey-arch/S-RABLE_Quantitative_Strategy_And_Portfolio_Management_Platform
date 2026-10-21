import { describe, expect, it } from 'vitest';
import { instrument } from './instrument-fixture';
import {
  EMPTY_FORM,
  formFromInstrument,
  lotSizeRule,
  textRule,
  tickSizeRule,
  toCreateBody,
  toUpdateBody,
} from './instrument-form';

describe('instrument form', () => {
  it('builds the create body with trimmed text and real numbers', () => {
    expect(
      toCreateBody({
        ...EMPTY_FORM,
        symbol: ' TCS ',
        trading_symbol: 'TCS-EQ',
        name: 'Tata Consultancy',
        lot_size: '1',
        tick_size: '0.05',
      }),
    ).toEqual({
      symbol: 'TCS',
      trading_symbol: 'TCS-EQ',
      name: 'Tata Consultancy',
      exchange: 'NSE',
      instrument_type: 'EQUITY',
      isin: null,
      lot_size: 1,
      tick_size: 0.05,
      is_active: true,
    });
  });

  it('an edit sends only what changed', () => {
    const before = instrument();
    expect(toUpdateBody(before, formFromInstrument(before))).toEqual({});
    expect(
      toUpdateBody(before, { ...formFromInstrument(before), name: 'RIL', lot_size: '5' }),
    ).toEqual({
      name: 'RIL',
      lot_size: 5,
    });
  });

  it('clearing the ISIN sends an empty string (null would mean unchanged)', () => {
    const before = instrument();
    expect(toUpdateBody(before, { ...formFromInstrument(before), isin: '  ' })).toEqual({
      isin: '',
    });
  });

  it('checks the same limits as the backend', () => {
    expect(textRule('symbol', 50)('  ')).toBe('Enter the symbol.');
    expect(textRule('symbol', 50)('x'.repeat(51))).toBe('Use at most 50 characters.');
    expect(textRule('symbol', 50)('TCS')).toBe(true);
    expect(lotSizeRule('0')).not.toBe(true);
    expect(lotSizeRule('1.5')).not.toBe(true);
    expect(lotSizeRule('25')).toBe(true);
    expect(tickSizeRule('0')).not.toBe(true);
    expect(tickSizeRule('abc')).not.toBe(true);
    expect(tickSizeRule('0.05')).toBe(true);
  });
});
