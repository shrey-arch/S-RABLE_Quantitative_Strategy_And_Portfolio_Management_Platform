import { PercentText } from '@/components/ui/value-text';
import { formatDate } from '@/lib/format';
import { istDate } from '@/features/instruments/market-data';
import { MetricTile, NotAvailable, Section } from './parts';
import {
  metricText,
  metricValue,
  SUMMARY_METRICS,
  TRADE_METRICS,
  type ExecutionResults,
  type MetricDef,
} from './results-model';

function Tiles(props: { results: ExecutionResults; metrics: MetricDef[] }) {
  const { summary } = props.results;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {props.metrics.map((metric) => (
        <MetricTile
          key={metric.key}
          results={props.results}
          metric={metric}
          extra={
            metric.key === 'max_drawdown' &&
            summary.max_drawdown_peak_at &&
            summary.max_drawdown_trough_at ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                Peak {formatDate(istDate(summary.max_drawdown_peak_at))}, low{' '}
                {formatDate(istDate(summary.max_drawdown_trough_at))}
              </p>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}

/**
 * The headline figure and the four numbers that qualify it, above the detail.
 * Every value comes from metricValue, so this repeats the tiles rather than
 * replacing them - the tiles stay where the tests expect them.
 */
function Headline({ results }: { results: ExecutionResults }) {
  const byLabel = (label: string) =>
    [...SUMMARY_METRICS, ...TRADE_METRICS].find((m) => m.label === label);
  const head = byLabel('Total return');
  const row = ['Final capital', 'Net profit', 'Max drawdown', 'Sharpe ratio']
    .map(byLabel)
    .filter((m): m is MetricDef => Boolean(m));
  if (!head) return null;

  const value = metricValue(results, head);
  const tone =
    value === null
      ? 'text-muted-foreground'
      : value > 0
        ? 'text-success'
        : value < 0
          ? 'text-destructive'
          : 'text-foreground';

  return (
    <div className="rounded-xl border border-border bg-surface-strip p-5 shadow-raised sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr] lg:gap-10">
        <div>
          <h2 className="micro-label">Overall performance</h2>
          <p
            data-headline={head.key}
            className={`mt-2 text-4xl font-semibold tracking-[-0.02em] tabular-nums sm:text-5xl ${tone}`}
          >
            {metricText(head.format, value)}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {head.label}, after charges and slippage
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-border">
          {row.map((metric, i) => (
            <div key={metric.key} className={i === 0 ? 'sm:pr-6' : 'sm:px-6'}>
              <dt className="text-[0.6875rem] font-semibold tracking-[0.06em] text-subtle-foreground">
                {metric.label}
              </dt>
              <dd className="mt-1.5 text-lg font-semibold tracking-[-0.01em] tabular-nums">
                {metricText(metric.format, metricValue(results, metric))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Summary tab: return and risk, trade statistics, benchmark, and how each is calculated. */
export function SummaryTab(props: { results: ExecutionResults; symbol: (id: string) => string }) {
  const { results } = props;
  const { benchmark } = results;
  return (
    <div className="space-y-6">
      <Headline results={results} />
      <Section
        id="performance"
        eyebrow="Full metrics"
        title="Return and risk"
        description="Computed by the backend from this run's equity curve. Hover or focus the (i) next to a number for its definition."
      >
        <Tiles results={results} metrics={SUMMARY_METRICS} />
      </Section>

      <Section
        id="trade-stats"
        eyebrow="Trade activity"
        title="Trade statistics"
        description="A trade runs from opening a position to being flat again. P&L is after charges."
      >
        <Tiles results={results} metrics={TRADE_METRICS} />
      </Section>

      <Section
        id="benchmark"
        eyebrow="Against buy and hold"
        title="Benchmark"
        description={
          benchmark
            ? `Buy and hold ${props.symbol(benchmark.instrument_id)}: the initial capital put into it at the first bar's close and held to the end (fractional units, no charges).`
            : 'Buy and hold of the first instrument.'
        }
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div role="group" aria-label="Strategy return" className="rounded-lg border border-border bg-surface-row p-3">
            <dt className="text-xs text-muted-foreground">Strategy, total return</dt>
            <dd className="mt-1 text-lg font-semibold">
              <PercentText value={results.summary.total_return} colored />
            </dd>
          </div>
          <div role="group" aria-label="Buy and hold return" className="rounded-lg border border-border bg-surface-row p-3">
            <dt className="text-xs text-muted-foreground">Buy and hold, total return</dt>
            <dd className="mt-1 text-lg font-semibold">
              {benchmark ? (
                <PercentText value={benchmark.total_return} colored />
              ) : (
                <NotAvailable reason={results.benchmark_unavailable_reason ?? undefined} />
              )}
            </dd>
          </div>
        </dl>
      </Section>

      <details className="rounded-xl border bg-card shadow-card p-4 text-sm sm:p-6">
        <summary className="cursor-pointer font-semibold">How these are calculated</summary>
        <dl className="mt-4 space-y-3">
          {[...SUMMARY_METRICS, ...TRADE_METRICS].map((metric) => (
            <div key={metric.key}>
              <dt className="font-medium">{metric.label}</dt>
              <dd className="text-muted-foreground">
                {metric.definition} {metric.basis(results.basis)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
