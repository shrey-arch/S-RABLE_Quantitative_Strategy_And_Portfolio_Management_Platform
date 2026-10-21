import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { IndicatorForm } from '@/features/indicators/IndicatorForm';
import type { IndicatorConfigValue, IndicatorInfo } from '@/features/indicators/queries';
import { usesOf, type Draft, type Problems } from './builder-model';

type Editing = { mode: 'add' } | { mode: 'edit'; index: number } | null;

const paramText = (parameters: Record<string, unknown>) =>
  Object.entries(parameters)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');

/**
 * Step 3: the indicators conditions can refer to. Types and parameters come from
 * GET /indicators and are checked by the backend (POST /indicators/{key}/validate)
 * before they are added, so what is listed here is what will be saved.
 */
export function IndicatorsEditor(props: {
  draft: Draft;
  catalogue: IndicatorInfo[];
  problems: Problems;
  showProblems: boolean;
  onSave: (value: IndicatorConfigValue, index: number | null) => void;
  onRemove: (index: number) => void;
}) {
  const { draft, catalogue } = props;
  const [editing, setEditing] = useState<Editing>(null);
  const names = draft.indicators.map((i) => i.name);

  const form = (index: number | null) => (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <p className="text-sm font-medium">
        {index === null ? 'New indicator' : `Edit ${draft.indicators[index]?.name ?? ''}`}
      </p>
      <IndicatorForm
        catalogue={catalogue}
        initial={index === null ? undefined : draft.indicators[index]}
        existingNames={names.filter((_, j) => j !== index)}
        submitLabel={index === null ? 'Add indicator' : 'Save indicator'}
        onSave={(value) => {
          props.onSave(value, index);
          setEditing(null);
        }}
      />
      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
        Cancel
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Give each indicator a unique name; conditions refer to it by that name. Indicators are
        calculated by the backend, never in the browser.
      </p>

      {draft.indicators.length === 0 && editing?.mode !== 'add' && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No indicators yet.
        </p>
      )}

      <ul className="space-y-3" aria-label="Indicators in this strategy">
        {draft.indicators.map((indicator, i) => {
          if (editing?.mode === 'edit' && editing.index === i) return <li key={i}>{form(i)}</li>;
          const uses = usesOf(draft, indicator.name);
          const problem = props.showProblems ? props.problems[`indicators.${i}`] : undefined;
          return (
            <li
              key={i}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm">
                  <span className="font-mono">{indicator.name}</span>
                  <span className="ml-2 text-muted-foreground">{indicator.type}</span>
                </p>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {paramText(indicator.parameters)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {uses === 0 ? 'Not used in a condition yet.' : `Used in ${uses} condition(s).`}
                </p>
                {problem && (
                  <p role="alert" className="text-xs text-destructive">
                    {problem}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${indicator.name}`}
                  onClick={() => setEditing({ mode: 'edit', index: i })}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${indicator.name}`}
                  onClick={() => {
                    setEditing(null);
                    props.onRemove(i);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {editing?.mode === 'add' ? (
        form(null)
      ) : (
        <Button type="button" variant="outline" onClick={() => setEditing({ mode: 'add' })}>
          <Plus /> Add indicator
        </Button>
      )}
    </div>
  );
}
