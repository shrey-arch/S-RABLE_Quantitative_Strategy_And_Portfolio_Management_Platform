import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Honesty label. Portfolio and backtest values are simulations, never live trading.
 * Phase 0: portfolio behaviour is simulation-only; no broker orders are placed.
 */
export function SimulationLabel(props: { kind?: 'historical' | 'simulated'; className?: string }) {
  const text =
    props.kind === 'historical' ? 'Historical simulation' : 'Simulated \u2014 no real orders';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning',
        props.className,
      )}
    >
      <FlaskConical aria-hidden className="size-3.5" />
      {text}
    </span>
  );
}
