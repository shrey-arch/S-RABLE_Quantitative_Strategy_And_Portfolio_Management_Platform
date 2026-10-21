import type { RegistryEntry } from './core-strategies';

/** GET /strategy-registry as the backend returns it (used by tests). */
export const REGISTRY_FIXTURE: RegistryEntry[] = [
  {
    strategy_key: 'momentum',
    parameters: [{ name: 'lookback', type: 'int', required: false, default: 20 }],
    required_inputs: ['close'],
    instruments: 'single',
  },
  {
    strategy_key: 'mean_reversion',
    parameters: [
      { name: 'lookback', type: 'int', required: false, default: 20 },
      { name: 'entry_threshold', type: 'float', required: false, default: 2.0 },
      { name: 'exit_threshold', type: 'float', required: false, default: 0.0 },
    ],
    required_inputs: ['close'],
    instruments: 'single',
  },
  {
    strategy_key: 'volatility_arbitrage',
    parameters: [
      { name: 'short_window', type: 'int', required: false, default: 5 },
      { name: 'long_window', type: 'int', required: false, default: 20 },
    ],
    required_inputs: ['close'],
    instruments: 'single',
  },
  {
    strategy_key: 'statistical_arbitrage',
    parameters: [
      { name: 'lookback', type: 'int', required: false, default: 20 },
      { name: 'entry_threshold', type: 'float', required: false, default: 2.0 },
      { name: 'exit_threshold', type: 'float', required: false, default: 0.0 },
    ],
    required_inputs: ['instrument_a', 'instrument_b'],
    instruments: 'pair',
  },
  {
    strategy_key: 'tactical_asset_allocation',
    parameters: [
      { name: 'lookback', type: 'int', required: false, default: 20 },
      { name: 'top_k', type: 'int', required: false, default: 2 },
    ],
    required_inputs: [],
    instruments: 'universe',
  },
];
