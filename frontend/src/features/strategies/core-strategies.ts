import type { components } from '@/api/schema';
import { humanize, MISSING } from '@/lib/format';

export type RegistryEntry = components['schemas']['StrategyRegistryEntry'];
export type RegistryParameter = components['schemas']['StrategyParameterInfo'];

/**
 * Plain-language descriptions of the five built-in strategies.
 *
 * Which strategies exist, their parameters and defaults always come from
 * GET /strategy-registry. This file only explains what the backend code does
 * (app/strategies/*.py, as built), so the cards can say it in words.
 */
export interface CoreStrategyInfo {
  name: string;
  summary: string;
  /** How the signal is decided: [condition, result] or [note]. */
  logic: [string, string?][];
  /** Values the strategy calculates internally from prices. */
  indicators: string[];
  /** What it returns on each bar. */
  outputs: string;
  /** One line per parameter name. */
  parameterHelp: Record<string, string>;
}

const INFO: Record<string, CoreStrategyInfo> = {
  momentum: {
    name: 'Momentum',
    summary: 'Follows the trend: buys while the price is above its moving average.',
    logic: [
      ['Close above SMA(lookback)', 'BUY'],
      ['Close below SMA(lookback)', 'SELL'],
      ['Otherwise, or with fewer than lookback bars', 'HOLD'],
    ],
    indicators: ['Simple moving average of close'],
    outputs: 'BUY / SELL / HOLD',
    parameterHelp: { lookback: 'Bars in the moving average' },
  },
  mean_reversion: {
    name: 'Mean Reversion',
    summary: 'Bets that stretched prices come back to their recent average.',
    logic: [
      ['Rolling z-score of close <= -entry_threshold', 'BUY'],
      ['Rolling z-score of close >= +entry_threshold', 'SELL'],
      ['Otherwise', 'HOLD'],
    ],
    indicators: ['Rolling z-score of close'],
    outputs: 'BUY / SELL / HOLD',
    parameterHelp: {
      lookback: 'Bars in the rolling window',
      entry_threshold: 'Z-score distance that triggers a trade',
      exit_threshold: 'Checked to be below entry_threshold; not used in the signal yet',
    },
  },
  volatility_arbitrage: {
    name: 'Volatility Arbitrage',
    summary:
      'Compares short-term and long-term realised volatility of returns. Not options volatility.',
    logic: [
      ['Spread = std of returns (short_window) - std of returns (long_window)'],
      ['Spread above 0', 'SELL'],
      ['Spread below 0', 'BUY'],
      ['Otherwise', 'HOLD'],
    ],
    indicators: ['Close-to-close returns', 'Rolling standard deviation (short and long)'],
    outputs: 'BUY / SELL / HOLD',
    parameterHelp: {
      short_window: 'Bars in the short volatility window (must be less than long_window)',
      long_window: 'Bars in the long volatility window',
    },
  },
  statistical_arbitrage: {
    name: 'Statistical Arbitrage',
    summary: 'Pairs trade on the price gap between two instruments, with equal 1-unit legs.',
    logic: [
      ['Spread = price A - price B; take its rolling z-score'],
      ['Z-score <= -entry_threshold', 'BUY (long A, short B)'],
      ['Z-score >= +entry_threshold', 'SELL (short A, long B)'],
      ['Otherwise', 'HOLD'],
    ],
    indicators: ['Price spread A - B', 'Rolling z-score of the spread'],
    outputs: 'BUY / SELL / HOLD with allocations for both legs',
    parameterHelp: {
      lookback: 'Bars in the rolling window',
      entry_threshold: 'Z-score distance that triggers a trade',
      exit_threshold: 'Checked to be below entry_threshold; not used in the signal yet',
    },
  },
  tactical_asset_allocation: {
    name: 'Tactical Asset Allocation',
    summary: 'Holds the best recent performers from a group of assets, in equal weights.',
    logic: [
      ['Rank every asset by its return over the last lookback bars'],
      ['Hold the top_k assets at 1/top_k weight each; the rest at 0'],
      ['BUY when the allocation changes, HOLD when it does not'],
    ],
    indicators: ['Trailing return per asset'],
    outputs: 'Allocations (weight per asset)',
    parameterHelp: {
      lookback: "Bars used to measure each asset's return",
      top_k: 'Number of assets held',
    },
  },
};

/** The rule engine that runs no-code strategies (not a template; never listed as one). */
const RULES_INFO: CoreStrategyInfo = {
  name: 'No-code rules',
  summary:
    'Runs the rules saved in the builder, long only: buys when every entry condition holds, sells back to flat when every exit condition holds.',
  logic: [
    ['Flat, and every entry condition holds', 'BUY (hold the quantity)'],
    ['Holding, and every exit condition holds', 'EXIT (back to flat)'],
    ['Otherwise', 'HOLD'],
  ],
  indicators: ['The indicators defined in the rules'],
  outputs: 'BUY / EXIT / HOLD',
  parameterHelp: {},
};

export function coreInfo(key: string): CoreStrategyInfo {
  if (key === 'no_code_rules') return RULES_INFO;
  return (
    INFO[key] ?? {
      name: humanize(key),
      summary: 'No description yet.',
      logic: [],
      indicators: [],
      outputs: MISSING,
      parameterHelp: {},
    }
  );
}

export type InstrumentLayout = RegistryEntry['instruments'];

/**
 * How many instruments a backtest of this strategy needs (GET /strategy-registry,
 * `instruments`): one, a pair (A and B), or a group of at least top_k.
 */
export function instrumentNeed(layout: InstrumentLayout): string {
  if (layout === 'pair') return 'Runs on two instruments (A and B).';
  if (layout === 'universe')
    return 'Runs on a group of instruments (at least top_k, and at least 2).';
  return 'Runs on one instrument.';
}

/** Shows a default the way the backend types it: float 2 -> "2.0", int 20 -> "20". */
export function formatParamValue(param: RegistryParameter): string {
  const value = param.default;
  if (value === null || value === undefined) return '\u2014';
  if (param.type === 'float' && typeof value === 'number' && Number.isInteger(value)) {
    return value.toFixed(1);
  }
  return String(value);
}
