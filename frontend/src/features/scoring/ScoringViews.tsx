import { useQueries } from '@tanstack/react-query';
import { CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import { Link } from 'react-router';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { istDate } from '@/features/instruments/market-data';
import { OVERLAY_COLORS, withAlpha } from '@/features/instruments/chart-colors';
import { RegimeChip } from '@/features/regime/RegimeChart';
import { Section } from '@/features/results/parts';
import {
  metricText,
  metricValue,
  SUMMARY_METRICS,
  TRADE_METRICS,
  type ExecutionResults,
} from '@/features/results/results-model';
import { coreInfo } from '@/features/strategies/core-strategies';
import { ValidationBadge, ValidationLinks } from '@/features/validation/ValidationBadge';
import { formatDate, formatDateTime, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
  COMPARE_METRICS,
  COMPATIBILITY_LABELS,
  DIRECTION_LABELS,
  MAX_COMPARE,
  rawText,
  scoreText,
  type Compatibility,
  type RegimeSnapshot,
  type ScoredStrategy,
  type ScoringDefinitions,
  type WeightsDraft,
} from './scoring-model';

const day = (timestamp: string | null | undefined) =>
  timestamp ? formatDate(istDate(timestamp)) : MISSING;

const templateName = (key: string | null) => (key ? coreInfo(key).name : MISSING);

/** The regime the compatibility column is judged against. */
export function RegimeBanner({ regime }: { regime: RegimeSnapshot | null }) {
  return (
    <div
      role="group"
      aria-label="Current regime"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-card shadow-card px-4 py-3 text-sm"
    >
      {regime ? (
        <>
          <span className="text-muted-foreground">Current regime:</span>
          <RegimeChip code={regime.code} />
          <span className="font-medium">{regime.name}</span>
          <span className="text-muted-foreground">
            {`(${formatPercent(regime.confidence)}) \u00b7 ${regime.instrument_symbol ?? 'Deleted instrument'} \u00b7 as of ${day(regime.as_of)} \u00b7 Model ${regime.model_number}. A model classification, not a forecast.`}
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">
          No regime model has been trained, so regime compatibility is unknown.{' '}
          <Link to="/app/regime?tab=training" className="font-medium text-primary hover:underline">
            Train one
          </Link>
        </span>
      )}
    </div>
  );
}

const COMPAT_CLASSES: Record<Compatibility['status'], string> = {
  COMPATIBLE: 'text-success',
  NOT_COMPATIBLE: 'text-destructive',
  UNKNOWN: 'text-muted-foreground',
};
const COMPAT_ICONS: Record<Compatibility['status'], React.ReactNode> = {
  COMPATIBLE: <CircleCheck aria-hidden className="size-3.5" />,
  NOT_COMPATIBLE: <CircleX aria-hidden className="size-3.5" />,
  UNKNOWN: <CircleHelp aria-hidden className="size-3.5" />,
};

/** The backend's compatibility verdict, with its reason in the tooltip and on demand. */
export function CompatibilityText({ value }: { value: Compatibility | null }) {
  if (!value) return <span className="text-muted-foreground">{MISSING}</span>;
  return (
    <span
      title={value.reason}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
        COMPAT_CLASSES[value.status],
      )}
    >
      {COMPAT_ICONS[value.status]}
      {COMPATIBILITY_LABELS[value.status]}
    </span>
  );
}

function ScoreBar({ value }: { value: number }) {
  const theme = useTheme();
  return (
    <div className="h-1.5 w-24 rounded bg-muted" aria-hidden>
      <div
        className="h-1.5 rounded"
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          background: OVERLAY_COLORS[theme][0],
        }}
      />
    </div>
  );
}

/** Scored strategies by rank, with every normalised factor and the regime verdict. */
export function RankingTable(props: {
  rows: ScoredStrategy[];
  selected: string[];
  onToggle: (id: string) => void;
  open: string | null;
  onOpen: (id: string) => void;
}) {
  if (props.rows.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        None of your strategies can be scored yet: backtest a strategy made from a core template.
      </p>
    );
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">Strategy ranking</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Compare</th>
            <th className="py-2 pr-2 font-medium">Rank</th>
            <th className="py-2 pr-2 font-medium">Strategy</th>
            <th className="py-2 pr-2 font-medium">Composite score</th>
            <th className="py-2 pr-2 font-medium">Normalised factors</th>
            <th className="py-2 pr-2 font-medium">Regime</th>
            <th className="py-2 pr-2 font-medium">Validation</th>
            <th className="py-2 pr-2 font-medium">Data</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Breakdown</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const checked = props.selected.includes(row.strategy_id);
            const full = !checked && props.selected.length >= MAX_COMPARE;
            return (
              <tr
                key={row.strategy_id}
                className={cn(
                  'border-b last:border-0 align-top',
                  props.open === row.strategy_id && 'bg-muted/40',
                )}
              >
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    aria-label={`Compare ${row.name}`}
                    checked={checked}
                    disabled={full}
                    title={full ? `Compare up to ${MAX_COMPARE} strategies.` : undefined}
                    onChange={() => props.onToggle(row.strategy_id)}
                  />
                </td>
                <td className="py-2 pr-2 font-semibold tabular-nums">{row.rank}</td>
                <td className="py-2 pr-2">
                  <Link
                    to={`/app/strategies/${row.strategy_id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{`${templateName(row.strategy_key)} \u00b7 v${row.version}`}</p>
                </td>
                <td className="py-2 pr-2">
                  <p className="font-semibold tabular-nums">{scoreText(row.composite_score)}</p>
                  <ScoreBar value={row.composite_score ?? 0} />
                </td>
                <td className="py-2 pr-2">
                  <ul className="space-y-0.5 text-xs">
                    {row.factors.map((f) => (
                      <li key={f.factor} className="flex justify-between gap-3 whitespace-nowrap">
                        <span className="text-muted-foreground">{f.label}</span>
                        <span className="tabular-nums">{formatNumber(f.normalized, 3)}</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="py-2 pr-2">
                  <CompatibilityText value={row.regime_compatibility} />
                </td>
                <td className="py-2 pr-2">
                  {row.validation && (
                    <div className="flex flex-col items-start gap-1">
                      <ValidationBadge validation={row.validation} />
                      <ValidationLinks validation={row.validation} strategyId={row.strategy_id} />
                    </div>
                  )}
                </td>
                <td className="py-2 pr-2 text-xs">
                  <p>{row.instruments.map((i) => i.symbol ?? 'Deleted').join(' / ')}</p>
                  <p className="text-muted-foreground">{`as of ${day(row.as_of)}`}</p>
                </td>
                <td className="py-2">
                  <Button
                    size="sm"
                    variant={props.open === row.strategy_id ? 'secondary' : 'outline'}
                    aria-pressed={props.open === row.strategy_id}
                    aria-label={`Breakdown of ${row.name}`}
                    onClick={() => props.onOpen(row.strategy_id)}
                  >
                    Breakdown
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Strategies that are not ranked, with the backend's reason. */
export function UnscoredList({ rows }: { rows: ScoredStrategy[] }) {
  if (rows.length === 0) return null;
  return (
    <Section
      id="unscored"
      title="Not scored"
      description="These strategies are not ranked; the reason comes from the backend."
    >
      <ul className="divide-y text-sm">
        {rows.map((row) => (
          <li
            key={row.strategy_id}
            className="flex flex-wrap items-start justify-between gap-2 py-2"
          >
            <div>
              <Link
                to={`/app/strategies/${row.strategy_id}`}
                className="font-medium text-primary hover:underline"
              >
                {row.name}
              </Link>
              <p className="text-muted-foreground">{row.reason}</p>
            </div>
            {!row.source_execution_id && row.strategy_type !== 'NO_CODE' && (
              <Link
                to={`/app/backtests/new?strategy=${row.strategy_id}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                Backtest it &rarr;
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Each factor's contribution as one segment of a bar that adds up to the composite. */
function ContributionBar({ row }: { row: ScoredStrategy }) {
  const theme = useTheme();
  const colors = OVERLAY_COLORS[theme];
  return (
    <figure className="space-y-2">
      <div
        role="img"
        aria-label={`Contributions of ${row.name}, adding up to ${scoreText(row.composite_score)}`}
        className="flex h-7 w-full overflow-hidden rounded border bg-muted"
      >
        {row.factors.map((f, i) => (
          <div
            key={f.factor}
            data-factor={f.factor}
            data-contribution={f.contribution}
            title={`${f.label}: ${scoreText(f.contribution)}`}
            className="flex h-full items-center justify-center overflow-hidden text-[10px] font-semibold whitespace-nowrap text-foreground"
            style={{
              width: `${f.contribution * 100}%`,
              background: withAlpha(colors[i % colors.length]!, '99'),
            }}
          >
            {f.contribution >= 0.08 ? scoreText(f.contribution) : ''}
          </div>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {row.factors.map((f, i) => (
          <span key={f.factor} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 rounded-sm"
              style={{ background: withAlpha(colors[i % colors.length]!, '99') }}
            />
            {`${f.label} ${scoreText(f.contribution)}`}
          </span>
        ))}
        <span>{`Full bar = 1.000; filled = composite ${scoreText(row.composite_score)}`}</span>
      </figcaption>
    </figure>
  );
}

/** Raw value, normalised value, weight and contribution of each factor. */
export function Breakdown({ row }: { row: ScoredStrategy }) {
  return (
    <Section
      id="breakdown"
      title={`Breakdown: ${row.name}`}
      description={`${templateName(row.strategy_key)} on ${row.instruments.map((i) => i.symbol ?? 'Deleted').join(' / ')}, as of ${day(row.as_of)}. Latest completed backtest: ${formatDateTime(row.source_completed_at)}.`}
      actions={
        row.source_execution_id && (
          <Link
            to={`/app/executions/${row.source_execution_id}/results`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Backtest results &rarr;
          </Link>
        )
      }
    >
      <ContributionBar row={row} />
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">Factor breakdown</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Factor</th>
              <th className="py-2 pr-2 text-right font-medium">Raw</th>
              <th className="py-2 pr-2 text-right font-medium">Normalised</th>
              <th className="py-2 pr-2 font-medium">Direction</th>
              <th className="py-2 pr-2 text-right font-medium">Suitability</th>
              <th className="py-2 pr-2 text-right font-medium">Weight</th>
              <th className="py-2 pr-2 text-right font-medium">Share</th>
              <th className="py-2 text-right font-medium">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {row.factors.map((f) => (
              <tr key={f.factor} className="border-b">
                <td className="py-1.5 pr-2 font-medium">{f.label}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{rawText(f.factor, f.raw)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {formatNumber(f.normalized, 3)}
                </td>
                <td className="py-1.5 pr-2 text-xs">{DIRECTION_LABELS[f.direction]}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{scoreText(f.suitability)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatNumber(f.weight, 2)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {formatPercent(f.weight_share)}
                </td>
                <td className="py-1.5 text-right tabular-nums">{scoreText(f.contribution)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-1.5 pr-2" colSpan={7}>
                Composite score
              </td>
              <td className="py-1.5 text-right tabular-nums">{scoreText(row.composite_score)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {row.regime_compatibility && (
        <p className="text-sm">
          <CompatibilityText value={row.regime_compatibility} />{' '}
          <span className="text-muted-foreground">{row.regime_compatibility.reason}</span>
        </p>
      )}
    </Section>
  );
}

/** The weights in use; editable, then sent with the next scoring request (not saved). */
export function WeightsPanel(props: {
  definitions: ScoringDefinitions;
  draft: WeightsDraft;
  onChange: (draft: WeightsDraft) => void;
  errors: Record<string, string>;
  custom: boolean;
  pending: boolean;
  onApply: () => void;
  onReset: () => void;
}) {
  const labels = new Map(props.definitions.factors.map((f) => [f.name, f.label]));
  return (
    <Section
      id="weights"
      title="Weights"
      description="Each strategy's factor weights. Change them and re-score: the backend checks and applies them to this request only; nothing is saved."
      actions={
        props.custom ? (
          <span className="text-xs font-medium text-warning">Custom weights in use</span>
        ) : undefined
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          props.onApply();
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {props.definitions.strategies.map((s) => (
            <fieldset key={s.strategy_key} className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{coreInfo(s.strategy_key).name}</legend>
              {s.factors.map((f) => {
                const id = `w-${s.strategy_key}-${f.name}`;
                const error = props.errors[`${s.strategy_key}.${f.name}`];
                return (
                  <div key={f.name} className="grid grid-cols-[1fr_6rem] items-center gap-2">
                    <label htmlFor={id} className="text-sm">
                      {labels.get(f.name) ?? f.name}
                      <span className="block text-xs text-muted-foreground">{`Default ${s.default_weights[f.name]}`}</span>
                    </label>
                    <Input
                      id={id}
                      inputMode="decimal"
                      aria-label={`${coreInfo(s.strategy_key).name}: ${labels.get(f.name) ?? f.name} weight`}
                      aria-invalid={error ? true : undefined}
                      value={props.draft[s.strategy_key]?.[f.name] ?? ''}
                      onChange={(e) =>
                        props.onChange({
                          ...props.draft,
                          [s.strategy_key]: {
                            ...props.draft[s.strategy_key],
                            [f.name]: e.target.value,
                          },
                        })
                      }
                    />
                    {error && (
                      <p className="col-span-2 text-xs text-destructive" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                );
              })}
              {props.errors[s.strategy_key] && (
                <p className="text-xs text-destructive" role="alert">
                  {props.errors[s.strategy_key]}
                </p>
              )}
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={props.pending}>
            Re-score with these weights
          </Button>
          <Button type="button" variant="outline" onClick={props.onReset}>
            Reset to defaults
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** How scores are made, as the backend documents it. */
export function DefinitionsView({ definitions }: { definitions: ScoringDefinitions }) {
  return (
    <div className="space-y-6">
      <Section id="method" title="How scores are made">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {definitions.method.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {`Windows: ${Object.entries(definitions.windows)
            .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v} days`)
            .join(', ')}.`}
        </p>
      </Section>
      <Section id="factor-definitions" title="Factors">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Factor definitions</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Factor</th>
                <th className="py-2 pr-2 font-medium">Raw value</th>
                <th className="py-2 font-medium">Normalisation</th>
              </tr>
            </thead>
            <tbody>
              {definitions.factors.map((f) => (
                <tr key={f.name} className="border-b last:border-0 align-top">
                  <td className="py-1.5 pr-2 font-medium">{f.label}</td>
                  <td className="py-1.5 pr-2">{f.raw}</td>
                  <td className="py-1.5">{f.normalization}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {Object.entries(definitions.directions).map(([key, text]) => (
            <li key={key}>{text}</li>
          ))}
        </ul>
      </Section>
      <Section
        id="regime-rules"
        title="Regime compatibility rules"
        description="An engineering rule from how each strategy trades; it never changes a score."
      >
        <ul className="divide-y text-sm">
          {definitions.strategies.map((s) => (
            <li key={s.strategy_key} className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
              <span className="font-medium">{coreInfo(s.strategy_key).name}</span>
              <span>{s.regime_rule.rule}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

const ALL_METRICS = [...SUMMARY_METRICS, ...TRADE_METRICS];

/** Two or three strategies side by side: scores from the API, metrics from each latest backtest. */
export function CompareView(props: {
  rows: ScoredStrategy[];
  ids: string[];
  onToggle: (id: string) => void;
}) {
  const chosen = props.ids
    .map((id) => props.rows.find((r) => r.strategy_id === id))
    .filter((r): r is ScoredStrategy => Boolean(r));
  const results = useQueries({
    queries: chosen.map((row) => ({
      queryKey: queryKeys.executions.results(row.source_execution_id ?? ''),
      queryFn: () =>
        unwrap(
          api.GET('/executions/{execution_id}/results', {
            params: { path: { execution_id: row.source_execution_id! } },
          }),
        ),
      enabled: Boolean(row.source_execution_id),
      staleTime: Infinity,
    })),
  });
  const candidates = props.rows.filter((r) => r.source_execution_id);
  const labels = [...new Set(chosen.flatMap((r) => r.factors.map((f) => f.label)))];
  const metrics = COMPARE_METRICS.map((key) => ALL_METRICS.find((m) => m.key === key)!);

  const cell = (i: number, render: (results: ExecutionResults) => string) => {
    const q = results[i]!;
    if (!chosen[i]!.source_execution_id) return 'No backtest';
    if (q.isError) return 'Could not load';
    return q.data ? render(q.data) : '...';
  };

  return (
    <div className="space-y-6">
      <Section
        id="compare-pick"
        title="Choose 2 or 3 strategies"
        description="Strategies with a completed backtest."
      >
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No strategy has a completed backtest yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Strategies to compare">
            {candidates.map((r) => {
              const checked = props.ids.includes(r.strategy_id);
              return (
                <li key={r.strategy_id}>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={checked}
                      disabled={!checked && props.ids.length >= MAX_COMPARE}
                      onChange={() => props.onToggle(r.strategy_id)}
                    />
                    {r.name}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {chosen.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Choose at least two strategies to compare them.
        </p>
      ) : (
        <Section
          id="comparison"
          title="Comparison"
          description="Scores from the scoring API; backtest metrics from each strategy's latest completed backtest (GET /executions/{id}/results)."
        >
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">Strategy comparison</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">
                    <span className="sr-only">Measure</span>
                  </th>
                  {chosen.map((r) => (
                    <th
                      key={r.strategy_id}
                      scope="col"
                      className="py-2 pr-2 text-right font-medium text-foreground"
                    >
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Template', chosen.map((r) => templateName(r.strategy_key))],
                    ['Rank', chosen.map((r) => (r.rank === null ? 'Not scored' : String(r.rank)))],
                    ['Composite score', chosen.map((r) => scoreText(r.composite_score))],
                    ...labels.map(
                      (label) =>
                        [
                          `${label} (normalised)`,
                          chosen.map((r) => {
                            const f = r.factors.find((x) => x.label === label);
                            return f ? formatNumber(f.normalized, 3) : MISSING;
                          }),
                        ] as [string, string[]],
                    ),
                    [
                      'Regime compatibility',
                      chosen.map((r) =>
                        r.regime_compatibility
                          ? COMPATIBILITY_LABELS[r.regime_compatibility.status]
                          : MISSING,
                      ),
                    ],
                    [
                      'Instruments',
                      chosen.map((r) =>
                        r.instruments.map((i) => i.symbol ?? 'Deleted').join(' / '),
                      ),
                    ],
                    ...metrics.map(
                      (m) =>
                        [
                          `Backtest: ${m.label}`,
                          chosen.map((_, i) =>
                            cell(i, (data) => metricText(m.format, metricValue(data, m))),
                          ),
                        ] as [string, string[]],
                    ),
                  ] as [string, string[]][]
                ).map(([label, values]) => (
                  <tr key={label} className="border-b last:border-0">
                    <th scope="row" className="w-40 py-1.5 pr-2 text-left font-medium sm:w-auto">
                      {label}
                    </th>
                    {values.map((v, i) => (
                      <td key={i} className="py-1.5 pr-2 text-right whitespace-nowrap tabular-nums">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
