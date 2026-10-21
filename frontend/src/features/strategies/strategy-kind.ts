import type { Strategy } from './queries';
import { templateOf } from './strategy-form';

/**
 * How a saved strategy was made, which decides where it is edited and whether a
 * backtest can run it:
 * - template: made from a core template (parameters.template). The backtest engine
 *   runs the template's code, so it can be backtested. Edited in the strategy dialog.
 * - no-code:  made in the no-code builder (StrategyConfig rules). Edited in the builder.
 * - python:   the user's own Python code. Edited in the Python editor, and run in
 *   the backend's isolated sandbox (Feature 6), so it can be backtested too.
 */
export type StrategyKind = 'template' | 'no-code' | 'python';

export function strategyKind(
  strategy: Pick<Strategy, 'strategy_type' | 'strategy_config' | 'python_code'>,
): StrategyKind {
  if (templateOf(strategy.strategy_config)) return 'template';
  if (strategy.strategy_type === 'NO_CODE') return 'no-code';
  if (strategy.python_code) return 'python';
  return 'template';
}

/** Why a strategy of this kind cannot be backtested (null: it can). */
export const BACKTEST_BLOCKED: Record<StrategyKind, string | null> = {
  template: null,
  'no-code': null,
  // Feature 6: custom Python runs in the backend's isolated sandbox.
  python: null,
};

/**
 * Feature 6: where custom Python cannot go yet. The sandbox starts a fresh
 * process per decision, which suits a backtest, a validation or a test run, not
 * a deployment or live session that trades every close for weeks.
 */
export const PYTHON_NOT_DEPLOYABLE =
  'Custom Python code can be backtested, validated and test-run, but it cannot be deployed to the paper account or run live yet.';

/** How a Python strategy is run and scored (backend: app/sandbox). */
export const PYTHON_SANDBOX_NOTE =
  'Your code runs in an isolated sandbox, one call per bar: only math, statistics, numpy and pandas, no files, no network, with time and memory limits.';

/** How a backtest runs a no-code strategy's rules (backend: app/strategies/rule_strategy.py). */
export const NO_CODE_BACKTEST_NOTE =
  'Backtests run these rules long only: while flat, when every entry condition holds at a close, the strategy buys the quantity; while holding, when every exit condition holds, it sells back to flat. With no exit conditions the position is held to the end. Nothing is traded until every indicator in the rules has a value.';
