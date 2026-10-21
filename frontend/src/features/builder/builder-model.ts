import type { components } from '@/api/schema';
import type { IndicatorConfigValue, IndicatorInfo } from '@/features/indicators/queries';
import {
  operandText,
  readConfig,
  type Condition,
  type Operand,
  type PriceField,
} from '@/features/strategies/strategy-config';
import { TEMPLATE_PARAM } from '@/features/strategies/strategy-form';

/**
 * The no-code builder's working copy of a strategy, and the pure functions that turn
 * it into a StrategyConfig v1 (exactly what POST/PATCH /strategies stores) and back.
 *
 * Everything the builder offers comes from the backend contract: the operators are
 * the five in Condition.operator, indicator types and their lines come from
 * GET /indicators, and an operand is a price field, an indicator line or a number.
 */

export type StrategyConfig = components['schemas']['StrategyConfig'];
export type Operator = Condition['operator'];

/** The operators StrategyConfig accepts (`satisfies` fails the build if they change). */
export const OPERATORS = ['<', '<=', '>', '>=', '=='] as const satisfies readonly Operator[];

export const OPERATOR_LABELS: Record<Operator, string> = {
  '<': 'is less than',
  '<=': 'is at most',
  '>': 'is greater than',
  '>=': 'is at least',
  '==': 'equals',
};

export const PARAM_KINDS = ['integer', 'float', 'string', 'boolean'] as const;
export type ParamKind = (typeof PARAM_KINDS)[number];

export interface ParamRow {
  key: string;
  kind: ParamKind;
  value: string;
}

export type OperandDraft =
  | { kind: 'price'; field: PriceField }
  | { kind: 'indicator'; name: string; output: string }
  | { kind: 'value'; text: string };

export type OperandKind = OperandDraft['kind'];

export interface ConditionDraft {
  left: OperandDraft;
  operator: Operator;
  right: OperandDraft;
}

export interface Draft {
  name: string;
  description: string;
  params: ParamRow[];
  indicators: IndicatorConfigValue[];
  entry: ConditionDraft[];
  exit: ConditionDraft[];
}

export type Side = 'entry' | 'exit';

export const STEPS = [
  { key: 'basics', title: 'Basics' },
  { key: 'parameters', title: 'Parameters' },
  { key: 'indicators', title: 'Indicators' },
  { key: 'entry', title: 'Entry conditions' },
  { key: 'exit', title: 'Exit conditions' },
  { key: 'review', title: 'Review' },
] as const;
export type StepKey = (typeof STEPS)[number]['key'];

export const NAME_MAX = 100;

export const emptyDraft = (): Draft => ({
  name: '',
  description: '',
  params: [],
  indicators: [],
  entry: [],
  exit: [],
});

/** Lines each indicator type has (GET /indicators `outputs`), e.g. MACD: macd, signal, histogram. */
export type OutputsByType = Record<string, string[]>;
export const outputsByType = (catalogue: IndicatorInfo[]): OutputsByType =>
  Object.fromEntries(catalogue.map((i) => [i.key, i.outputs]));

/** The lines of a named indicator in the draft ([] when the name is not defined). */
export function linesOf(draft: Draft, outputs: OutputsByType, name: string): string[] {
  const indicator = draft.indicators.find((i) => i.name === name);
  return indicator ? (outputs[indicator.type] ?? []) : [];
}

/** A fresh condition row: the first indicator (or the close) compared with a number. */
export function newCondition(draft: Draft, outputs: OutputsByType): ConditionDraft {
  const first = draft.indicators[0];
  const left: OperandDraft = first
    ? { kind: 'indicator', name: first.name, output: (outputs[first.type] ?? [])[0] ?? '' }
    : { kind: 'price', field: 'close' };
  return { left, operator: '<', right: { kind: 'value', text: '' } };
}

/** Switching an operand's kind keeps a sensible value for the new kind. */
export function operandOfKind(
  kind: OperandKind,
  draft: Draft,
  outputs: OutputsByType,
): OperandDraft {
  if (kind === 'price') return { kind, field: 'close' };
  if (kind === 'value') return { kind, text: '' };
  const first = draft.indicators[0];
  return { kind, name: first?.name ?? '', output: first ? (outputs[first.type]?.[0] ?? '') : '' };
}

// ---------------------------------------------------------------------------------
// Validation (mirrors StrategyConfig; the backend still has the last word on save)
// ---------------------------------------------------------------------------------

/** Problem messages keyed by where they belong, e.g. "params.0.key", "entry.1.right". */
export type Problems = Record<string, string>;

const PARAM_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTEGER = /^-?\d+$/;

function parseParam(row: ParamRow): string | number | boolean | { error: string } {
  const raw = row.value.trim();
  switch (row.kind) {
    case 'integer':
      return INTEGER.test(raw) ? Number(raw) : { error: 'Enter a whole number.' };
    case 'float': {
      const n = Number(raw);
      return raw !== '' && Number.isFinite(n) ? n : { error: 'Enter a number.' };
    }
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : { error: 'Choose true or false.' };
    default:
      return row.value;
  }
}

function parseNumber(text: string): number | null {
  const raw = text.trim();
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? n : null;
}

function operandProblem(
  operand: OperandDraft,
  draft: Draft,
  outputs: OutputsByType,
): string | null {
  if (operand.kind === 'value') {
    return parseNumber(operand.text) === null ? 'Enter a number.' : null;
  }
  if (operand.kind === 'price') return null;
  if (!operand.name) return 'Choose an indicator.';
  const indicator = draft.indicators.find((i) => i.name === operand.name);
  if (!indicator) return `${operand.name} is not defined. Add it in Indicators, or choose another.`;
  const lines = outputs[indicator.type] ?? [];
  if (lines.length > 1 && !lines.includes(operand.output)) {
    return `Choose a line of ${operand.name}: ${lines.join(', ')}.`;
  }
  return null;
}

export function validateDraft(draft: Draft, outputs: OutputsByType): Problems {
  const problems: Problems = {};

  const name = draft.name.trim();
  if (!name) problems.name = 'Enter a name.';
  else if (name.length > NAME_MAX) problems.name = `Use at most ${NAME_MAX} characters.`;

  const seenKeys = new Set<string>();
  draft.params.forEach((row, i) => {
    const key = row.key.trim();
    if (!key) problems[`params.${i}.key`] = 'Enter a name.';
    else if (!PARAM_KEY.test(key))
      problems[`params.${i}.key`] = 'Use letters, digits and _ only, starting with a letter or _.';
    else if (key === TEMPLATE_PARAM)
      problems[`params.${i}.key`] =
        '"template" is used by strategies made from a core template; choose another name.';
    else if (seenKeys.has(key)) problems[`params.${i}.key`] = 'Another parameter has this name.';
    seenKeys.add(key);
    const value = parseParam(row);
    if (typeof value === 'object') problems[`params.${i}.value`] = value.error;
  });

  const seenNames = new Set<string>();
  draft.indicators.forEach((indicator, i) => {
    if (!(indicator.type in outputs))
      problems[`indicators.${i}`] =
        `${indicator.type} is not an indicator type the backend offers.`;
    else if (seenNames.has(indicator.name))
      problems[`indicators.${i}`] = 'Indicator names must be unique.';
    seenNames.add(indicator.name);
  });

  for (const side of ['entry', 'exit'] as const) {
    draft[side].forEach((c, i) => {
      const left = operandProblem(c.left, draft, outputs);
      const right = operandProblem(c.right, draft, outputs);
      if (left) problems[`${side}.${i}.left`] = left;
      if (right) problems[`${side}.${i}.right`] = right;
      if (!left && !right && c.left.kind === 'value' && c.right.kind === 'value')
        problems[`${side}.${i}`] = 'Compare at least one price or indicator.';
    });
  }
  return problems;
}

/** Problems that belong to one step (Basics shows "name", Entry shows "entry.*", ...). */
export function problemsOf(problems: Problems, step: StepKey): string[] {
  const prefix: Record<StepKey, (key: string) => boolean> = {
    basics: (k) => k === 'name',
    parameters: (k) => k.startsWith('params.'),
    indicators: (k) => k.startsWith('indicators.'),
    entry: (k) => k.startsWith('entry.'),
    exit: (k) => k.startsWith('exit.'),
    review: () => false,
  };
  return Object.keys(problems).filter(prefix[step]);
}

/** Where a problem is, in words: "Entry condition 2, right side". */
export function problemPlace(key: string): string {
  const [area, index, part] = key.split('.');
  const n = Number(index) + 1;
  switch (area) {
    case 'name':
      return 'Name';
    case 'params':
      return `Parameter ${n} ${part === 'key' ? 'name' : 'value'}`;
    case 'indicators':
      return `Indicator ${n}`;
    case 'entry':
    case 'exit': {
      const title = `${area === 'entry' ? 'Entry' : 'Exit'} condition ${n}`;
      return part ? `${title}, ${part} side` : title;
    }
    default:
      return key;
  }
}

// ---------------------------------------------------------------------------------
// Draft <-> StrategyConfig
// ---------------------------------------------------------------------------------

function toOperand(operand: OperandDraft, draft: Draft, outputs: OutputsByType): Operand {
  if (operand.kind === 'price') return { type: 'price', field: operand.field };
  if (operand.kind === 'value') return { type: 'value', value: parseNumber(operand.text) ?? 0 };
  // Always explicit: single-line indicators get their only line, as the backend stores it.
  const lines = linesOf(draft, outputs, operand.name);
  const output = lines.length === 1 ? lines[0]! : operand.output;
  return { type: 'indicator', name: operand.name, output };
}

/**
 * The StrategyConfig POST/PATCH /strategies receives. Call only when validateDraft
 * found no problems. The backend stores it unchanged: indicator parameters come
 * already completed from POST /indicators/{key}/validate, and every indicator
 * reference names its line.
 */
export function toConfig(draft: Draft, outputs: OutputsByType): StrategyConfig {
  const parameters: StrategyConfig['parameters'] = {};
  for (const row of draft.params) {
    const value = parseParam(row);
    if (typeof value !== 'object') parameters[row.key.trim()] = value;
  }
  const condition = (c: ConditionDraft): Condition => ({
    left: toOperand(c.left, draft, outputs),
    operator: c.operator,
    right: toOperand(c.right, draft, outputs),
  });
  return {
    parameters,
    indicators: draft.indicators.map((i) => ({
      name: i.name,
      type: i.type,
      parameters: i.parameters,
    })),
    entry_conditions: draft.entry.map(condition),
    exit_conditions: draft.exit.map(condition),
  };
}

function fromOperand(operand: Operand): OperandDraft {
  if (operand.type === 'price') return { kind: 'price', field: operand.field };
  if (operand.type === 'indicator')
    return { kind: 'indicator', name: operand.name, output: operand.output ?? '' };
  return { kind: 'value', text: String(operand.value) };
}

function kindOf(value: string | number | boolean): ParamKind {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return Number.isInteger(value) ? 'integer' : 'float';
}

/**
 * A saved strategy as a draft. `lossy` is true when part of the saved configuration
 * could not be read (it was not made by this builder); saving would drop that part.
 */
export function fromStrategy(strategy: {
  name: string;
  description: string | null;
  strategy_config: unknown;
}): { draft: Draft; lossy: boolean } {
  const view = readConfig(strategy.strategy_config);
  const raw = (strategy.strategy_config ?? {}) as Record<string, unknown>;
  const count = (key: string) => {
    const v = raw[key];
    if (Array.isArray(v)) return v.length;
    return v && typeof v === 'object' ? Object.keys(v).length : 0;
  };
  const lossy =
    count('parameters') !== view.parameters.length ||
    count('indicators') !== view.indicators.length ||
    count('entry_conditions') !== view.entry.length ||
    count('exit_conditions') !== view.exit.length;

  const draft: Draft = {
    name: strategy.name,
    description: strategy.description ?? '',
    params: view.parameters.map(([key, value]) => ({
      key,
      kind: kindOf(value),
      value: String(value),
    })),
    indicators: view.indicators.map((i) => ({
      name: i.name,
      type: i.type,
      parameters: (i.parameters ?? {}) as Record<string, number>,
    })),
    entry: view.entry.map((c) => ({
      left: fromOperand(c.left),
      operator: c.operator,
      right: fromOperand(c.right),
    })),
    exit: view.exit.map((c) => ({
      left: fromOperand(c.left),
      operator: c.operator,
      right: fromOperand(c.right),
    })),
  };
  return { draft, lossy };
}

/** Renaming an indicator updates every condition that refers to it. */
export function renameReferences(draft: Draft, from: string, to: string): Draft {
  if (from === to) return draft;
  const fix = (o: OperandDraft): OperandDraft =>
    o.kind === 'indicator' && o.name === from ? { ...o, name: to } : o;
  const fixAll = (list: ConditionDraft[]) =>
    list.map((c) => ({ ...c, left: fix(c.left), right: fix(c.right) }));
  return { ...draft, entry: fixAll(draft.entry), exit: fixAll(draft.exit) };
}

/** How many conditions use an indicator. */
export function usesOf(draft: Draft, name: string): number {
  const uses = (o: OperandDraft) => o.kind === 'indicator' && o.name === name;
  return [...draft.entry, ...draft.exit].filter((c) => uses(c.left) || uses(c.right)).length;
}

// ---------------------------------------------------------------------------------
// Plain-English summary
// ---------------------------------------------------------------------------------

/**
 * "Enter when sma_20 < close and rsi_14 < 30." All conditions of a side must be true
 * together; the contract has no OR, so the builder does not offer one.
 */
export function sideSentence(side: Side, conditions: Condition[]): string {
  const verb = side === 'entry' ? 'Enter' : 'Exit';
  if (conditions.length === 0) return `No ${side} conditions.`;
  const parts = conditions.map(
    (c) => `${operandText(c.left)} ${c.operator} ${operandText(c.right)}`,
  );
  return `${verb} when ${parts.join(' and ')}.`;
}
