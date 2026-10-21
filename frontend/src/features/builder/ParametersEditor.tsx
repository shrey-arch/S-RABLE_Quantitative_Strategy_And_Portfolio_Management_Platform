import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { PARAM_KINDS, type ParamKind, type ParamRow, type Problems } from './builder-model';

const KIND_LABELS: Record<ParamKind, string> = {
  integer: 'Whole number',
  float: 'Decimal number',
  string: 'Text',
  boolean: 'True / false',
};

function ErrorText({ text }: { text?: string }) {
  return text ? (
    <p role="alert" className="text-xs text-destructive">
      {text}
    </p>
  ) : null;
}

/** Step 2: named scalar values saved with the strategy (string, integer, float, boolean). */
export function ParametersEditor(props: {
  rows: ParamRow[];
  problems: Problems;
  showProblems: boolean;
  onChange: (rows: ParamRow[]) => void;
}) {
  const { rows } = props;
  const problem = (key: string) => (props.showProblems ? props.problems[key] : undefined);
  const update = (i: number, patch: Partial<ParamRow>) =>
    props.onChange(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optional named values saved with the strategy, such as a quantity or a risk percentage. Each
        value is text, a whole number, a decimal number or true/false.
      </p>

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No parameters yet.
        </p>
      )}

      <ol className="space-y-3">
        {rows.map((row, i) => {
          const label = `Parameter ${i + 1}`;
          const keyError = problem(`params.${i}.key`);
          const valueError = problem(`params.${i}.value`);
          return (
            <li
              key={i}
              className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 space-y-1">
                <Input
                  aria-label={`${label} name`}
                  aria-invalid={keyError ? true : undefined}
                  placeholder="name, e.g. quantity"
                  autoComplete="off"
                  value={row.key}
                  onChange={(e) => update(i, { key: e.target.value })}
                />
                <ErrorText text={keyError} />
              </div>
              <NativeSelect
                aria-label={`${label} type`}
                value={row.kind}
                onChange={(e) => {
                  const kind = e.target.value as ParamKind;
                  update(i, { kind, value: kind === 'boolean' ? 'true' : row.value });
                }}
              >
                {PARAM_KINDS.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <div className="min-w-0 space-y-1">
                {row.kind === 'boolean' ? (
                  <NativeSelect
                    aria-label={`${label} value`}
                    className="w-full"
                    value={row.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                  >
                    <NativeSelectOption value="true">true</NativeSelectOption>
                    <NativeSelectOption value="false">false</NativeSelectOption>
                  </NativeSelect>
                ) : (
                  <Input
                    aria-label={`${label} value`}
                    aria-invalid={valueError ? true : undefined}
                    inputMode={
                      row.kind === 'integer' ? 'numeric' : row.kind === 'float' ? 'decimal' : 'text'
                    }
                    autoComplete="off"
                    value={row.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                )}
                <ErrorText text={valueError} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove parameter ${i + 1}`}
                onClick={() => props.onChange(rows.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="outline"
        onClick={() => props.onChange([...rows, { key: '', kind: 'integer', value: '' }])}
      >
        <Plus /> Add parameter
      </Button>
    </div>
  );
}
