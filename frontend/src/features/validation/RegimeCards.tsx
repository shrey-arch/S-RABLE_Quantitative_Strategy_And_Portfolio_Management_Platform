import { formatNumber, formatPercent } from '@/lib/format';
import { percentOrMissing, type RegimeRow } from './validation-model';

/**
 * Tints of the cards. These follow the same semantics as classColor in
 * regime-model.ts - calm leans green, volatile amber, stress red - so a card
 * and the chart legend never disagree about a regime.
 */
const TINTS = {
  calm: 'border-success/25 bg-regime-calm text-regime-calm-ink',
  volatile: 'border-warning/35 bg-regime-volatile text-regime-volatile-ink',
  stress: 'border-destructive/25 bg-regime-stress text-regime-stress-ink',
  overall: 'border-border bg-regime-overall text-foreground',
} as const;
type Tint = keyof typeof TINTS;

/** Rule-based keys and supervised class names; anything else is neutral. */
const TINT_OF = new Map<string, Tint>([
  ['bull_low_volatility', 'calm'],
  ['bull_high_volatility', 'volatile'],
  ['bear_low_volatility', 'volatile'],
  ['bear_high_volatility', 'stress'],
  ['Low volatility', 'calm'],
  ['High volatility', 'volatile'],
  ['Uptrend', 'calm'],
  ['Downtrend', 'stress'],
  ['Risk-on', 'calm'],
  ['Risk-off', 'stress'],
]);

const tintFor = (row: RegimeRow): Tint =>
  TINT_OF.get(row.key) ?? TINT_OF.get(row.name) ?? 'overall';

/** The most cards worth showing; beyond this the table reads better alone. */
const MAX_CARDS = 6;

/**
 * One tinted card per observed regime, above the table.
 *
 * aria-hidden on purpose: every figure here is also in the table that follows,
 * and the table is the accessible copy. A combined supervised model can produce
 * a dozen regimes, so past MAX_CARDS this renders nothing.
 */
export function RegimeCards({ rows, code }: { rows: RegimeRow[]; code?: boolean }) {
  const observed = rows.filter((r) => r.days > 0);
  if (observed.length === 0 || observed.length > MAX_CARDS) return null;
  return (
    <div aria-hidden className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {observed.map((r) => (
        <div key={r.key} className={`rounded-lg border p-3 ${TINTS[tintFor(r)]}`}>
          <p className="text-[0.6875rem] font-semibold tracking-[0.06em] opacity-85">
            {code && r.code ? `${r.code} \u00b7 ` : ''}
            {r.name}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.01em] tabular-nums">
            {percentOrMissing(r.total_return)}
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums opacity-85">
            <div className="flex gap-1">
              <dt>Days</dt>
              <dd className="font-medium">{formatNumber(r.days, 0)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Share</dt>
              <dd className="font-medium">{formatPercent(r.share)}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Max DD</dt>
              <dd className="font-medium">{percentOrMissing(r.max_drawdown)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
