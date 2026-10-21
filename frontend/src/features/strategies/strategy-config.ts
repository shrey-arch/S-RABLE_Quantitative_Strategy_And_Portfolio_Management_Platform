import type { components } from '@/api/schema';

type Schemas = components['schemas'];
export type Condition = Schemas['Condition'];
export type Operand = Condition['left'];
export type IndicatorConfig = Schemas['IndicatorConfig'];
export type ParameterValue = string | number | boolean;

export interface ReadableConfig {
  parameters: [string, ParameterValue][];
  indicators: IndicatorConfig[];
  entry: Condition[];
  exit: Condition[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isScalar = (v: unknown): v is ParameterValue =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

export const PRICE_FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

function isOperand(v: unknown): v is Operand {
  if (!isObject(v)) return false;
  if (v.type === 'value') return isScalar(v.value);
  if (v.type === 'price') return PRICE_FIELDS.includes(v.field as PriceField);
  return (
    v.type === 'indicator' &&
    typeof v.name === 'string' &&
    (v.output === undefined || v.output === null || typeof v.output === 'string')
  );
}

function conditions(v: unknown): Condition[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (c): c is Condition =>
      isObject(c) && isOperand(c.left) && isOperand(c.right) && typeof c.operator === 'string',
  );
}

/**
 * The backend returns strategy_config as a plain object. It is validated when saved
 * (StrategyConfig), but this reads it defensively so an unexpected shape never
 * breaks the page: anything unreadable is simply left out of the structured view
 * (the raw JSON view still shows everything).
 */
export function readConfig(raw: unknown): ReadableConfig {
  const config = isObject(raw) ? raw : {};
  const params = isObject(config.parameters) ? config.parameters : {};
  return {
    parameters: Object.entries(params).filter((e): e is [string, ParameterValue] => isScalar(e[1])),
    indicators: Array.isArray(config.indicators)
      ? config.indicators.filter(
          (i): i is IndicatorConfig =>
            isObject(i) && typeof i.name === 'string' && typeof i.type === 'string',
        )
      : [],
    entry: conditions(config.entry_conditions),
    exit: conditions(config.exit_conditions),
  };
}

/**
 * "close", "sma_20", "macd.signal" or a fixed value. A single-line indicator's line is
 * "value" and is not shown; other lines are written as name.line.
 */
export function operandText(operand: Operand): string {
  switch (operand.type) {
    case 'price':
      return operand.field;
    case 'indicator':
      return operand.output && operand.output !== 'value'
        ? `${operand.name}.${operand.output}`
        : operand.name;
    default:
      return String(operand.value);
  }
}

export function conditionText(c: Condition): string {
  return `${operandText(c.left)} ${c.operator} ${operandText(c.right)}`;
}

/** "sma_20 = SMA(window 20)". */
export function indicatorText(i: IndicatorConfig): string {
  const params = Object.entries(i.parameters ?? {})
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');
  return `${i.name} = ${i.type}(${params})`;
}

/**
 * A no-code strategy's rules as the backtest runs them (long only), in sentences:
 * the indicators, when it buys, and when it sells back to flat.
 */
export function rulesSentences(raw: unknown): string[] {
  const view = readConfig(raw);
  const all = (cs: Condition[]) => cs.map(conditionText).join(' and ');
  return [
    view.indicators.length
      ? `Indicators: ${view.indicators.map(indicatorText).join('; ')}.`
      : 'No indicators.',
    view.entry.length ? `Buy when ${all(view.entry)}.` : 'No entry conditions: it never buys.',
    view.exit.length
      ? `Sell back to flat when ${all(view.exit)}.`
      : 'No exit conditions: the position is held to the end.',
  ];
}
