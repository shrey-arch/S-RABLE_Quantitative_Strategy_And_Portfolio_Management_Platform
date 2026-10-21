import type { RegistryEntry, RegistryParameter } from './core-strategies';
import type { ParameterValue } from './strategy-config';

/**
 * Pure helpers for the create / edit form. A strategy made from a core template stores
 * the template's key in its parameters (`template`) next to the template's own
 * parameters, so the form can find the right parameter schema again later.
 */

export const TEMPLATE_PARAM = 'template';
export const NAME_MAX = 100;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The template key saved in a strategy_config, if any. */
export function templateOf(config: unknown): string | null {
  const params = isObject(config) && isObject(config.parameters) ? config.parameters : {};
  const key = params[TEMPLATE_PARAM];
  return typeof key === 'string' && key ? key : null;
}

/** Saved parameter values of a strategy_config (without the template key). */
export function savedParams(config: unknown): Record<string, unknown> {
  const params = isObject(config) && isObject(config.parameters) ? config.parameters : {};
  return Object.fromEntries(Object.entries(params).filter(([name]) => name !== TEMPLATE_PARAM));
}

/** Text shown in each input: the saved value if it has one, else the template default. */
export function paramInputs(
  entry: RegistryEntry,
  saved: Record<string, unknown> = {},
): Record<string, string> {
  return Object.fromEntries(
    entry.parameters.map((p) => {
      const value = p.name in saved ? saved[p.name] : p.default;
      return [p.name, value === null || value === undefined ? '' : String(value)];
    }),
  );
}

const INTEGER = /^-?\d+$/;

function parseOne(param: RegistryParameter, text: string): ParameterValue | { error: string } {
  const raw = text.trim();
  if (raw === '') return { error: 'Enter a value.' };
  switch (param.type) {
    case 'int':
      return INTEGER.test(raw) ? Number(raw) : { error: 'Enter a whole number.' };
    case 'float': {
      const n = Number(raw);
      return raw !== '' && Number.isFinite(n) ? n : { error: 'Enter a number.' };
    }
    case 'bool':
      return raw === 'true' ? true : raw === 'false' ? false : { error: 'Choose true or false.' };
    default:
      return raw;
  }
}

/** Turns the inputs into typed values, or per-field messages. */
export function parseParams(
  entry: RegistryEntry,
  inputs: Record<string, string | undefined>,
):
  | { ok: true; values: Record<string, ParameterValue> }
  | { ok: false; errors: Record<string, string> } {
  const values: Record<string, ParameterValue> = {};
  const errors: Record<string, string> = {};
  for (const param of entry.parameters) {
    const result = parseOne(param, inputs[param.name] ?? '');
    if (typeof result === 'object') errors[param.name] = result.error;
    else values[param.name] = result;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}

/**
 * strategy_config for a template strategy. Indicators and conditions already saved on
 * the strategy are kept unchanged; only the parameters are replaced.
 */
export function buildConfig(
  templateKey: string,
  values: Record<string, ParameterValue>,
  base?: unknown,
) {
  const b = isObject(base) ? base : {};
  return {
    parameters: { [TEMPLATE_PARAM]: templateKey, ...values },
    indicators: Array.isArray(b.indicators) ? b.indicators : [],
    entry_conditions: Array.isArray(b.entry_conditions) ? b.entry_conditions : [],
    exit_conditions: Array.isArray(b.exit_conditions) ? b.exit_conditions : [],
  };
}

/**
 * The backend's parameter checks answer with one sentence, e.g.
 * "short_window must be less than long_window." This picks the parameter the
 * sentence is about (the first one it names), so the message shows under that field.
 */
export function fieldForMessage(message: string, names: string[]): string | null {
  let best: { name: string; at: number } | null = null;
  for (const name of names) {
    const match = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).exec(message);
    if (match && (best === null || match.index < best.at)) best = { name, at: match.index };
  }
  return best?.name ?? null;
}

/** "Alpha" -> "Alpha (copy)", kept within the backend's 100-character limit. */
export function copyName(name: string): string {
  const suffix = ' (copy)';
  return `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
}
