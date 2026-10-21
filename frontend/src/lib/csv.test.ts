import { describe, expect, it } from 'vitest';
import { csvField, toCsv } from './csv';

describe('csv', () => {
  it('quotes only when needed and leaves missing values empty', () => {
    expect(csvField('RELIANCE')).toBe('RELIANCE');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(-100.57)).toBe('-100.57');
    expect(csvField(false)).toBe('false');
  });

  it('keeps numbers exactly as given', () => {
    expect(toCsv(['a', 'b'], [[0.30000000000000004, 1e-7]])).toBe(
      'a,b\r\n0.30000000000000004,1e-7\r\n',
    );
  });
});
