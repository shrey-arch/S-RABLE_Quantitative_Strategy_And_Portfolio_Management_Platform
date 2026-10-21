import { describe, expect, it } from 'vitest';
import { filtersFor, parseRecordRef, recordRef, statusesFor } from './records-model';

describe('records model', () => {
  it('each tab reads only the filters its API takes', () => {
    const params = new URLSearchParams(
      'execution=e1&instrument=i1&status=OPEN&side=SELL&direction=SHORT&from=2026-01-01&to=2026-02-01',
    );
    const dates = { start_date: '2026-01-01', end_date: '2026-02-01' };
    expect(filtersFor('orders', params)).toEqual({
      execution_id: 'e1',
      instrument_id: 'i1',
      status: 'OPEN',
      side: 'SELL',
      ...dates,
    });
    expect(filtersFor('trades', params)).toEqual({
      execution_id: 'e1',
      instrument_id: 'i1',
      side: 'SELL',
      ...dates,
    });
    expect(filtersFor('positions', params)).toEqual({
      execution_id: 'e1',
      instrument_id: 'i1',
      status: 'OPEN',
      direction: 'SHORT',
      ...dates,
    });
    expect(filtersFor('orders', new URLSearchParams())).toEqual({});
    expect(statusesFor('trades')).toEqual([]);
  });

  it('the open record lives in the address', () => {
    const id = '0d000000-0000-4000-8000-000000000001';
    expect(parseRecordRef(`order:${id}`)).toEqual({ kind: 'order', id });
    expect(recordRef({ kind: 'position', id })).toBe(`position:${id}`);
    expect(parseRecordRef('order:not-an-id')).toBeNull();
    expect(parseRecordRef(null)).toBeNull();
  });
});
