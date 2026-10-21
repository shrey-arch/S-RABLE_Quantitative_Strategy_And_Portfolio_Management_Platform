import { AlertCircle, BookOpen, FlaskConical, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCreateStrategy, useUpdateStrategy } from '@/features/strategies/queries';
import { NAME_MAX } from '../builder-model';
import { CodeEditor } from './CodeEditor';
import { ContextDocs } from './ContextDocs';
import { EMPTY_CONFIG, PYTHON_TEMPLATE } from './python-template';
import { TestRunPanel } from './TestRunPanel';

/** Pydantic prefixes validator messages with "Value error, "; the rest is the reason. */
const cleanMessage = (text: string) => text.replace(/^Value error, /, '');

function saveMessages(error: unknown): { name?: string; code: string[] } {
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
    const code: string[] = [];
    let name: string | undefined;
    for (const [field, message] of Object.entries(error.fieldErrors)) {
      if (field === 'name') name = cleanMessage(message);
      else code.push(cleanMessage(message));
    }
    return { name, code };
  }
  return { code: [(error as Error).message] };
}

export interface PythonDraft {
  name: string;
  description: string;
  code: string;
}

/**
 * Write and save a Python strategy (StrategyType PYTHON). The code is stored in
 * python_code through POST/PATCH /strategies; the backend checks its syntax and the
 * generate_signal(context) entry point, and raises the version when the code
 * changes. Running it is not offered: there is no isolated runner yet.
 */
export function PythonEditor(props: {
  initial: PythonDraft;
  strategyId?: string;
  version?: number;
}) {
  const id = useId();
  const navigate = useNavigate();
  const create = useCreateStrategy();
  const update = useUpdateStrategy();
  const [draft, setDraft] = useState(props.initial);
  const [nameError, setNameError] = useState<string>();
  // Code problems, and whether they came from the backend (a refused save).
  const [codeErrors, setCodeErrors] = useState<string[]>([]);
  const [fromBackend, setFromBackend] = useState(false);
  // Feature 6: the line a sandbox error points at, highlighted in the editor.
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const saving = create.isPending || update.isPending;
  const edit = (patch: Partial<PythonDraft>) => {
    setCodeErrors([]);
    setNameError(undefined);
    setDraft((d) => ({ ...d, ...patch }));
  };

  async function save() {
    const name = draft.name.trim();
    const description = draft.description.trim();
    const problems = draft.code.trim() ? [] : ['Write the strategy code first.'];
    setFromBackend(false);
    setNameError(
      !name
        ? 'Enter a name.'
        : name.length > NAME_MAX
          ? `Use at most ${NAME_MAX} characters.`
          : undefined,
    );
    setCodeErrors(problems);
    if (!name || name.length > NAME_MAX || problems.length) return;

    try {
      const saved = props.strategyId
        ? await update.mutateAsync({
            id: props.strategyId,
            body: { name, description, python_code: draft.code },
          })
        : await create.mutateAsync({
            name,
            description: description || null,
            strategy_type: 'PYTHON',
            strategy_config: EMPTY_CONFIG,
            python_code: draft.code,
          });
      navigate(`/app/strategies/${saved.id}`);
    } catch (error) {
      const messages = saveMessages(error);
      setNameError(messages.name);
      setCodeErrors(messages.code);
      setFromBackend(true);
    }
  }

  const codeErrorId = `${id}-code-error`;
  const runNoteId = `${id}-run-note`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required error={nameError} hint={`Up to ${NAME_MAX} characters.`}>
          {(field) => (
            <Input
              {...field}
              maxLength={NAME_MAX}
              autoComplete="off"
              value={draft.name}
              onChange={(e) => edit({ name: e.target.value })}
            />
          )}
        </FormField>
        <FormField label="Description" hint="Optional.">
          {(field) => (
            <Textarea
              {...field}
              rows={2}
              value={draft.description}
              onChange={(e) => edit({ description: e.target.value })}
            />
          )}
        </FormField>
      </div>

      <section aria-labelledby={`${id}-code`} className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id={`${id}-code`} className="text-lg font-semibold">
              Strategy code
            </h2>
            <p className="text-sm text-muted-foreground">
              Define <code className="font-mono">generate_signal(context)</code> at the top level;
              it returns a <code className="font-mono">StrategySignal</code>. The template below
              explains the contract.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => edit({ code: PYTHON_TEMPLATE })}
            disabled={draft.code === PYTHON_TEMPLATE}
          >
            <RotateCcw /> Start from the template
          </Button>
        </div>

        <CodeEditor
          value={draft.code}
          onChange={(code) => edit({ code })}
          label="Python code"
          invalid={codeErrors.length > 0}
          describedBy={codeErrors.length > 0 ? codeErrorId : undefined}
          errorLine={errorLine}
        />

        {codeErrors.length > 0 && (
          <div
            id={codeErrorId}
            role="alert"
            className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              {fromBackend && <p className="font-medium">The backend did not save the strategy:</p>}
              <ul className="space-y-1">
                {codeErrors.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          When you save, the backend checks the syntax and that{' '}
          <code className="font-mono">generate_signal</code> takes exactly one argument. It does not
          run the code; use Test run below for that.
        </p>
      </section>

      <div
        id={runNoteId}
        className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground"
      >
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Your code runs in an isolated sandbox: only math, statistics, numpy and pandas, no files,
          no network, and time and memory limits. It can be test-run here, backtested and validated.
        </span>
      </div>

      <section aria-labelledby={`${id}-run`} className="space-y-3 rounded-xl border bg-card p-4">
        <h2 id={`${id}-run`} className="sr-only">
          Test run and reference
        </h2>
        <Tabs defaultValue="test-run">
          <TabsList aria-label="Test run and reference">
            <TabsTrigger value="test-run">
              <FlaskConical aria-hidden className="size-4" /> Test run
            </TabsTrigger>
            <TabsTrigger value="reference">
              <BookOpen aria-hidden className="size-4" /> What the code can use
            </TabsTrigger>
          </TabsList>
          <TabsContent value="test-run" className="pt-3">
            <TestRunPanel strategyId={props.strategyId} onGoToLine={setErrorLine} />
          </TabsContent>
          <TabsContent value="reference" className="pt-3">
            <ContextDocs onInsertExample={(code) => edit({ code })} />
          </TabsContent>
        </Tabs>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {props.strategyId && (
            <>
              <Button type="button" variant="outline" asChild>
                <Link to={`/app/backtests/new?strategy=${props.strategyId}`}>Backtest it</Link>
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to={`/app/validation/new?strategy=${props.strategyId}`}>Validate it</Link>
              </Button>
            </>
          )}
        </div>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner /> : <Save />}
          {props.strategyId ? 'Save changes' : 'Create strategy'}
        </Button>
      </div>
      {props.strategyId && props.version !== undefined && (
        <p className="text-right text-xs text-muted-foreground">
          Saved as version {props.version}. Saving changed code makes version {props.version + 1}; a
          new name or description alone does not.
        </p>
      )}
    </div>
  );
}
