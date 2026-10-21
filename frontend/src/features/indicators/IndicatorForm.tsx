import { useId, useState } from 'react';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import {
  limitText,
  validateIndicator,
  type IndicatorConfigValue,
  type IndicatorInfo,
  type IndicatorParameter,
} from './queries';

type Errors = Record<string, string>;

const defaults = (spec: IndicatorInfo | undefined) =>
  Object.fromEntries(
    (spec?.parameters ?? []).map((p) => [p.name, p.default === null ? '' : String(p.default)]),
  );

/** Browser-side checks that mirror the backend's limits; the backend has the last word. */
function checkParameter(p: IndicatorParameter, raw: string): [number | undefined, string?] {
  const text = raw.trim();
  if (!text) return p.required ? [undefined, `${p.name} is required.`] : [undefined];
  const value = Number(text);
  if (!Number.isFinite(value)) return [undefined, `${p.name} must be a number.`];
  if (p.type === 'int' && !Number.isInteger(value))
    return [undefined, `${p.name} must be a whole number.`];
  if (p.minimum !== null && p.minimum !== undefined) {
    if (p.exclusive_minimum ? value <= p.minimum : value < p.minimum)
      return [undefined, `${p.name} must be ${limitText(p)}.`];
  }
  return [value];
}

/**
 * Name, type and parameters of one indicator, as a strategy configuration stores it.
 * Types and parameters come from GET /indicators; on save the backend checks the
 * parameters (POST /indicators/{key}/validate) and `onSave` gets its answer, with
 * defaults filled in. Used by the strategy builder and the catalogue page.
 */
export function IndicatorForm(props: {
  catalogue: IndicatorInfo[];
  onSave: (value: IndicatorConfigValue) => void;
  /** Names already used in the strategy; a new name must differ. */
  existingNames?: string[];
  initial?: IndicatorConfigValue;
  showName?: boolean;
  submitLabel?: string;
}) {
  const id = useId();
  const showName = props.showName ?? true;
  const [type, setType] = useState(props.initial?.type ?? props.catalogue[0]?.key ?? '');
  const spec = props.catalogue.find((i) => i.key === type);
  const [name, setName] = useState(props.initial?.name ?? '');
  const [values, setValues] = useState<Record<string, string>>(() =>
    props.initial
      ? Object.fromEntries(Object.entries(props.initial.parameters).map(([k, v]) => [k, String(v)]))
      : defaults(spec),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const chooseType = (next: string) => {
    setType(next);
    setValues(defaults(props.catalogue.find((i) => i.key === next)));
    setErrors({});
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!spec) return;
    const found: Errors = {};
    const trimmed = name.trim();
    if (showName) {
      if (!trimmed) found.name = 'Give the indicator a name.';
      else if ((props.existingNames ?? []).includes(trimmed))
        found.name = 'Another indicator in this strategy already has this name.';
    }
    const parameters: Record<string, number> = {};
    for (const p of spec.parameters) {
      const [value, error] = checkParameter(p, values[p.name] ?? '');
      if (error) found[p.name] = error;
      else if (value !== undefined) parameters[p.name] = value;
    }
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const result = await validateIndicator(spec.key, parameters);
      props.onSave({ name: trimmed, type: result.key, parameters: result.parameters });
    } catch (error) {
      const message = (error as Error).message;
      // The backend names the parameter first ("window must be ...").
      const field = spec.parameters.find((p) => message.startsWith(`${p.name} `));
      setErrors(
        error instanceof ApiError && error.status === 422
          ? { [field?.name ?? 'form']: message }
          : { form: message },
      );
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} role="alert" className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;
  const described = (key: string, hint?: boolean) =>
    [errors[key] ? `${id}-${key}-error` : '', hint ? `${id}-${key}-hint` : '']
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {showName && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              placeholder="e.g. sma_fast"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={described('name', true)}
              onChange={(e) => setName(e.target.value)}
            />
            {fieldError('name') ?? (
              <p id={`${id}-name-hint`} className="text-xs text-muted-foreground">
                Conditions refer to the indicator by this name.
              </p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-type`}>Type</Label>
          <NativeSelect
            id={`${id}-type`}
            className="w-full"
            value={type}
            onChange={(e) => chooseType(e.target.value)}
          >
            {props.catalogue.map((i) => (
              <NativeSelectOption key={i.key} value={i.key}>
                {i.key} - {i.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      {spec && (
        <div className="grid gap-4 sm:grid-cols-3">
          {spec.parameters.map((p) => (
            <div key={p.name} className="space-y-1.5">
              <Label htmlFor={`${id}-${p.name}`}>
                {p.name}
                {p.required && (
                  <span aria-hidden className="text-destructive">
                    *
                  </span>
                )}
              </Label>
              <Input
                id={`${id}-${p.name}`}
                inputMode={p.type === 'int' ? 'numeric' : 'decimal'}
                value={values[p.name] ?? ''}
                aria-invalid={errors[p.name] ? true : undefined}
                aria-describedby={described(p.name, true)}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
              />
              {fieldError(p.name) ?? (
                <p id={`${id}-${p.name}-hint`} className="text-xs text-muted-foreground">
                  {p.type === 'int' ? 'Whole number' : 'Number'}, {limitText(p)}
                  {p.default !== null ? `; default ${p.default}` : '; required'}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {spec && spec.rules.length > 0 && (
        <p className="text-xs text-muted-foreground">Also: {spec.rules.join(' ')}</p>
      )}
      {fieldError('form')}
      <Button type="submit" disabled={saving || !spec}>
        {saving && <Spinner />}
        {props.submitLabel ?? 'Save indicator'}
      </Button>
    </form>
  );
}
