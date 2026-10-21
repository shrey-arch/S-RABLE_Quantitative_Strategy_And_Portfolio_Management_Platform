import { AlertCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { humanize } from '@/lib/format';
import { coreInfo, type RegistryEntry } from './core-strategies';
import {
  useCreateStrategy,
  useRegistry,
  useUpdateStrategy,
  validateTemplateParams,
  type Strategy,
} from './queries';
import {
  buildConfig,
  copyName,
  fieldForMessage,
  NAME_MAX,
  paramInputs,
  parseParams,
  savedParams,
  templateOf,
} from './strategy-form';

/**
 * What the dialog does:
 * - new:       create a strategy from a core template (chosen here, or fixed by the card)
 * - duplicate: create a copy of one of the user's strategies
 * - edit:      change one of the user's strategies
 */
export type FormTarget =
  | { kind: 'new'; templateKey?: string }
  | { kind: 'duplicate'; source: Strategy }
  | { kind: 'edit'; strategy: Strategy };

interface Values {
  name: string;
  description: string;
  template: string;
  params: Record<string, string>;
}

/** Middle dot separator (written as a char code so the file stays ASCII). */
const DOT = ` ${String.fromCharCode(0xb7)} `;

/** Strategies made from a core template run the template's Python code. */
const TEMPLATE_TYPE = 'PYTHON' as const;

function titleOf(target: FormTarget): string {
  if (target.kind === 'edit') return `Edit ${target.strategy.name}`;
  if (target.kind === 'duplicate') return `Duplicate ${target.source.name}`;
  return target.templateKey
    ? `New strategy from ${coreInfo(target.templateKey).name}`
    : 'New strategy';
}

function StrategyForm(props: {
  target: FormTarget;
  registry: RegistryEntry[];
  onDone: () => void;
}) {
  const { target, registry } = props;
  const navigate = useNavigate();
  const create = useCreateStrategy();
  const update = useUpdateStrategy();
  const [formError, setFormError] = useState<string | null>(null);

  const existing =
    target.kind === 'edit' ? target.strategy : target.kind === 'duplicate' ? target.source : null;
  const initialTemplate = existing
    ? templateOf(existing.strategy_config)
    : (target.kind === 'new' && target.templateKey) || registry[0]?.strategy_key || null;
  const templateChoosable = target.kind === 'new' && !target.templateKey;
  const findEntry = (key: string | null) => registry.find((e) => e.strategy_key === key) ?? null;
  const initialEntry = findEntry(initialTemplate);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    shouldUnregister: true,
    defaultValues: {
      name:
        target.kind === 'edit'
          ? target.strategy.name
          : target.kind === 'duplicate'
            ? copyName(target.source.name)
            : initialEntry && target.templateKey
              ? copyName(coreInfo(initialEntry.strategy_key).name)
              : '',
      description: existing?.description ?? '',
      template: initialTemplate ?? '',
      params: initialEntry
        ? paramInputs(initialEntry, existing ? savedParams(existing.strategy_config) : {})
        : {},
    },
  });

  // The template is a form field only when the user can choose it; otherwise it is fixed.
  const chosenTemplate = watch('template');
  const templateKey = templateChoosable ? chosenTemplate || null : initialTemplate;
  const entry = findEntry(templateKey);
  const paramValues = watch('params');
  // Shown in the Advanced view: exactly what will be sent (unparsed values while typing).
  const preview = entry
    ? buildConfig(entry.strategy_key, paramValues ?? {}, existing?.strategy_config)
    : existing?.strategy_config;
  const strategyType = existing ? existing.strategy_type : TEMPLATE_TYPE;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    let config: unknown = existing?.strategy_config;

    if (entry) {
      const parsed = parseParams(entry, values.params ?? {});
      if (!parsed.ok) {
        for (const [name, message] of Object.entries(parsed.errors)) {
          setError(`params.${name}`, { message });
        }
        return;
      }
      try {
        await validateTemplateParams(entry.strategy_key, parsed.values);
      } catch (error) {
        const message = (error as Error).message;
        const field =
          error instanceof ApiError && error.status === 422
            ? fieldForMessage(
                message,
                entry.parameters.map((p) => p.name),
              )
            : null;
        if (field) setError(`params.${field}`, { message });
        else setFormError(message);
        return;
      }
      config = buildConfig(entry.strategy_key, parsed.values, existing?.strategy_config);
    }

    const name = values.name.trim();
    const description = values.description.trim();
    try {
      if (target.kind === 'edit') {
        await update.mutateAsync({
          id: target.strategy.id,
          body: {
            name,
            description,
            ...(entry ? { strategy_config: config as never } : {}),
          },
        });
        props.onDone();
      } else {
        const created = await create.mutateAsync({
          name,
          description: description || null,
          strategy_type: strategyType as never,
          strategy_config: config as never,
          // A duplicate of a Python strategy keeps its code.
          python_code: existing?.python_code ?? null,
        });
        props.onDone();
        navigate(`/app/strategies/${created.id}`);
      }
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        const other: string[] = [];
        for (const [key, message] of Object.entries(error.fieldErrors)) {
          if (key === 'name' || key === 'description') setError(key, { message });
          else other.push(`${key}: ${message}`);
        }
        if (other.length) setFormError(other.join(' '));
      } else {
        setFormError((error as Error).message);
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{formError}</span>
        </div>
      )}

      <FormField label="Name" required error={errors.name?.message}>
        {(field) => (
          <Input
            {...field}
            maxLength={NAME_MAX}
            autoComplete="off"
            {...register('name', {
              validate: (v) => {
                const n = v.trim().length;
                if (n === 0) return 'Enter a name.';
                if (n > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
                return true;
              },
            })}
          />
        )}
      </FormField>

      <FormField label="Description" error={errors.description?.message} hint="Optional.">
        {(field) => <Textarea {...field} rows={2} {...register('description')} />}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        {templateChoosable ? (
          <FormField label="Core template">
            {(field) => (
              <NativeSelect
                {...field}
                className="w-full"
                {...register('template', {
                  onChange: (e: { target: { value: string } }) => {
                    const next = findEntry(e.target.value);
                    if (next) setValue('params', paramInputs(next));
                  },
                })}
              >
                {registry.map((e) => (
                  <option key={e.strategy_key} value={e.strategy_key}>
                    {coreInfo(e.strategy_key).name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">Core template</p>
            <p className="text-sm text-muted-foreground">
              {templateKey ? coreInfo(templateKey).name : 'None'}
            </p>
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium">Type</p>
          <p className="text-sm text-muted-foreground">
            {humanize(strategyType)}
            {target.kind === 'edit' ? ' (fixed when created)' : ''}
          </p>
        </div>
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Parameters</legend>
        {!entry ? (
          <p className="text-sm text-muted-foreground">
            {templateKey
              ? `The template "${templateKey}" is not in the registry, so its parameters cannot be edited here.`
              : 'This strategy was not made from a core template. Its configuration is kept as it is.'}
          </p>
        ) : entry.parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">This template has no parameters.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {entry.parameters.map((p) => (
              <FormField
                key={`${entry.strategy_key}-${p.name}`}
                label={p.name}
                required={p.required}
                error={errors.params?.[p.name]?.message}
                hint={
                  [p.type, coreInfo(entry.strategy_key).parameterHelp[p.name]]
                    .filter(Boolean)
                    .join(DOT) || undefined
                }
              >
                {(field) =>
                  p.type === 'bool' ? (
                    <NativeSelect {...field} className="w-full" {...register(`params.${p.name}`)}>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </NativeSelect>
                  ) : (
                    <Input
                      {...field}
                      inputMode={
                        p.type === 'int' ? 'numeric' : p.type === 'float' ? 'decimal' : 'text'
                      }
                      className="font-mono"
                      {...register(`params.${p.name}`)}
                    />
                  )
                }
              </FormField>
            ))}
          </div>
        )}
      </fieldset>

      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Advanced: strategy_config (JSON)</summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
          {JSON.stringify(preview ?? {}, null, 2)}
        </pre>
      </details>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={props.onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {target.kind === 'edit' ? 'Save changes' : 'Create strategy'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Create, duplicate or edit a strategy in a dialog. The form is fresh each time it opens. */
export function StrategyFormDialog(props: { target: FormTarget; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const registry = useRegistry();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titleOf(props.target)}</DialogTitle>
          <DialogDescription>
            {props.target.kind === 'edit'
              ? 'Changes are saved to your strategy.'
              : 'A new strategy is saved to your account. The core templates are never changed.'}
          </DialogDescription>
        </DialogHeader>
        {registry.isPending ? (
          <LoadingState rows={5} />
        ) : registry.isError ? (
          <ErrorState error={registry.error} onRetry={() => void registry.refetch()} />
        ) : (
          open && (
            <StrategyForm
              target={props.target}
              registry={registry.data}
              onDone={() => setOpen(false)}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
