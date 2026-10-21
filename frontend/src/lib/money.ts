/**
 * Exact money arithmetic for backend decimal strings ("12345.67").
 * Adding with floats can drift by a paisa, so amounts are added as whole paise.
 */
const MONEY = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

function toPaise(value: string): bigint {
  const match = MONEY.exec(value.trim());
  if (!match) throw new Error(`Not a money amount: "${value}"`);
  const [, sign, rupees, fraction = ''] = match;
  const paise = BigInt(rupees!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign ? -paise : paise;
}

/** Sum of decimal strings, returned as a decimal string with 2 places. */
export function sumMoney(values: readonly string[]): string {
  const total = values.reduce((acc, v) => acc + toPaise(v), 0n);
  const negative = total < 0n;
  const abs = negative ? -total : total;
  const rupees = abs / 100n;
  const paise = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${rupees}.${paise}`;
}
