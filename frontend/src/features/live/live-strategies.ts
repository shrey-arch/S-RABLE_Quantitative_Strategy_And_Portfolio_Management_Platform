import { backtestable, entryFor } from '@/features/backtests/backtest-model';
import type { RegistryEntry } from '@/features/strategies/core-strategies';
import type { Strategy } from '@/features/strategies/queries';

/** Strategies a live session runs: template or no-code, on one instrument. */
export function liveRunnable(strategies: Strategy[], registry: RegistryEntry[]): Strategy[] {
  return backtestable(strategies, registry).filter(
    (s) => (entryFor(s, registry)?.instruments ?? 'single') === 'single',
  );
}
