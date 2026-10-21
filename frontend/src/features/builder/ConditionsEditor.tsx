import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { PRICE_FIELDS, type PriceField } from '@/features/strategies/strategy-config';
import {
  linesOf,
  newCondition,
  OPERATOR_LABELS,
  OPERATORS,
  operandOfKind,
  type ConditionDraft,
  type Draft,
  type OperandDraft,
  type OperandKind,
  type Operator,
  type OutputsByType,
  type Problems,
  type Side,
} from './builder-model';

const KIND_LABELS: Record<OperandKind, string> = {
  price: 'Price',
  indicator: 'Indicator',
  value: 'Number',
};

function ErrorText({ text }: { text?: string }) {
  return text ? (
    <p role="alert" className="text-xs text-destructive">
      {text}
    </p>
  ) : null;
}

/** One side of a condition: a price field, an indicator line or a number. */
function OperandEditor(props: {
  label: string;
  operand: OperandDraft;
  draft: Draft;
  outputs: OutputsByType;
  error?: string;
  onChange: (next: OperandDraft) => void;
}) {
  const { operand, draft, outputs, label } = props;
  const invalid = props.error ? true : undefined;
  const hasIndicators = draft.indicators.length > 0;
  const names = draft.indicators.map((i) => i.name);
  const lines = operand.kind === 'indicator' ? linesOf(draft, outputs, operand.name) : [];

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          aria-label={`${label} kind`}
          value={operand.kind}
          onChange={(e) =>
            props.onChange(operandOfKind(e.target.value as OperandKind, draft, outputs))
          }
        >
          {(Object.keys(KIND_LABELS) as OperandKind[]).map((kind) => (
            <NativeSelectOption
              key={kind}
              value={kind}
              disabled={kind === 'indicator' && !hasIndicators && operand.kind !== 'indicator'}
            >
              {KIND_LABELS[kind]}
              {kind === 'indicator' && !hasIndicators ? ' (add one first)' : ''}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        {operand.kind === 'price' && (
          <NativeSelect
            aria-label={`${label} price`}
            value={operand.field}
            onChange={(e) => props.onChange({ kind: 'price', field: e.target.value as PriceField })}
          >
            {PRICE_FIELDS.map((f) => (
              <NativeSelectOption key={f} value={f}>
                {f}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}

        {operand.kind === 'indicator' && (
          <>
            <NativeSelect
              aria-label={`${label} indicator`}
              aria-invalid={invalid}
              value={operand.name}
              onChange={(e) => {
                const name = e.target.value;
                props.onChange({
                  kind: 'indicator',
                  name,
                  output: linesOf(draft, outputs, name)[0] ?? '',
                });
              }}
            >
              {!names.includes(operand.name) && (
                <NativeSelectOption value={operand.name}>
                  {operand.name ? `${operand.name} (not defined)` : 'Choose'}
                </NativeSelectOption>
              )}
              {names.map((n) => (
                <NativeSelectOption key={n} value={n}>
                  {n}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {lines.length > 1 && (
              <NativeSelect
                aria-label={`${label} line`}
                aria-invalid={invalid}
                value={operand.output}
                onChange={(e) => props.onChange({ ...operand, output: e.target.value })}
              >
                {!lines.includes(operand.output) && (
                  <NativeSelectOption value={operand.output}>Choose a line</NativeSelectOption>
                )}
                {lines.map((line) => (
                  <NativeSelectOption key={line} value={line}>
                    {line}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </>
        )}

        {operand.kind === 'value' && (
          <Input
            aria-label={`${label} number`}
            aria-invalid={invalid}
            inputMode="decimal"
            className="w-32"
            value={operand.text}
            onChange={(e) => props.onChange({ kind: 'value', text: e.target.value })}
          />
        )}
      </div>
      <ErrorText text={props.error} />
    </div>
  );
}

/** Steps 4 and 5: rows of operand / operator / operand. All rows must be true together. */
export function ConditionsEditor(props: {
  side: Side;
  draft: Draft;
  outputs: OutputsByType;
  problems: Problems;
  showProblems: boolean;
  onChange: (next: ConditionDraft[]) => void;
}) {
  const { side, draft, outputs } = props;
  const rows = draft[side];
  const title = side === 'entry' ? 'Entry condition' : 'Exit condition';
  const problem = (key: string) => (props.showProblems ? props.problems[key] : undefined);
  const update = (i: number, next: ConditionDraft) =>
    props.onChange(rows.map((row, j) => (j === i ? next : row)));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {side === 'entry'
          ? 'The strategy enters when all of these are true.'
          : 'The strategy exits when all of these are true.'}{' '}
        Compare a price, an indicator line or a number. The operators are the five the backend
        accepts: &lt; &lt;= &gt; &gt;= ==.
      </p>

      {rows.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No {side} conditions yet.
        </p>
      )}

      <ol className="space-y-3">
        {rows.map((row, i) => {
          const label = `${title} ${i + 1}`;
          return (
            <li key={i}>
              <fieldset className="space-y-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{label}</legend>
                <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
                  <OperandEditor
                    label={`${label} left`}
                    operand={row.left}
                    draft={draft}
                    outputs={outputs}
                    error={problem(`${side}.${i}.left`)}
                    onChange={(left) => update(i, { ...row, left })}
                  />
                  <NativeSelect
                    aria-label={`${label} operator`}
                    value={row.operator}
                    onChange={(e) => update(i, { ...row, operator: e.target.value as Operator })}
                  >
                    {OPERATORS.map((op) => (
                      <NativeSelectOption key={op} value={op}>
                        {op} ({OPERATOR_LABELS[op]})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <OperandEditor
                    label={`${label} right`}
                    operand={row.right}
                    draft={draft}
                    outputs={outputs}
                    error={problem(`${side}.${i}.right`)}
                    onChange={(right) => update(i, { ...row, right })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${label.toLowerCase()}`}
                    onClick={() => props.onChange(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <ErrorText text={problem(`${side}.${i}`)} />
              </fieldset>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="outline"
        onClick={() => props.onChange([...rows, newCondition(draft, outputs)])}
      >
        <Plus /> Add {side} condition
      </Button>
    </div>
  );
}
