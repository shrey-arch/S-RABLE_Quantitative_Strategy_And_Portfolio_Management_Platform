import { useMemo } from 'react';
import { useExecutions } from '@/features/backtests/queries';
import { useInstruments } from '@/features/instruments/queries';
import { useMyStrategies } from '@/features/strategies/queries';
import type { Names } from './record-columns';
import { executionLabel } from './records-model';

/** Names of executions and instruments from the lists the app already loads. */
export function useNames(): Names & { ready: boolean } {
  const executions = useExecutions({});
  const strategies = useMyStrategies();
  const instruments = useInstruments();
  return useMemo(() => {
    const strategyName = new Map((strategies.data ?? []).map((s) => [s.id, s.name]));
    const byId = new Map((executions.data ?? []).map((e) => [e.id, e]));
    const symbols = new Map((instruments.data ?? []).map((i) => [i.id, i.symbol]));
    return {
      ready: Boolean(executions.data && strategies.data && instruments.data),
      execution: (id) =>
        id
          ? byId.has(id)
            ? executionLabel(byId.get(id), (s) => strategyName.get(s))
            : `Backtest ${id.slice(0, 8)}`
          : '',
      instrument: (id) => (id ? (symbols.get(id) ?? id.slice(0, 8)) : ''),
    };
  }, [executions.data, strategies.data, instruments.data]);
}
