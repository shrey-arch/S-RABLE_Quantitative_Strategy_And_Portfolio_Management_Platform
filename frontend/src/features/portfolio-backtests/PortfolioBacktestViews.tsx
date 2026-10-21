import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { RegimeChip } from '@/features/regime/RegimeChart';
import { Row, Section } from '@/features/results/parts';
import { coreInfo } from '@/features/strategies/core-strategies';
import { ToneBox } from '@/features/validation/StageViews';
import { ValidationBadge } from '@/features/validation/ValidationBadge';
import { formatDate, formatINR, formatPercent, MISSING } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import {
  affectedNames,
  formatMetric,
  frequencyLabel,
  METRIC_ROWS,
  OBJECTIVE_KEYS,
  OBJECTIVE_LABELS,
  RELATIVE_ROWS,
  SERIES_LABELS,
  seriesIn,
  seriesPoints,
  strategyOrder,
  weightRows,
  type PortfolioBacktestDetail,
  type PortfolioBacktestResults,
  type RebalanceEntry,
} from './pb-model';
import { sleeveColor } from './pb-colors';
import { LinesChart, WeightsChart } from './PortfolioCharts';

/** Objective 6: Sharpe 30%+ higher and maximum drawdown 25%+ lower than Nifty 50. */
export function ObjectivesView({ results }: { results: PortfolioBacktestResults }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {OBJECTIVE_KEYS.map((key) => {
        const o = results.objectives[key];
        const format = key === 'sharpe_improvement' ? 'ratio' : 'percent';
        return (
          <ToneBox key={key} tone={o.met ? 'success' : 'danger'} label={OBJECTIVE_LABELS[key]}>
            <p className="flex items-center gap-2 font-semibold">
              {o.met ? (
                <CircleCheck aria-hidden className="size-4" />
              ) : (
                <CircleX aria-hidden className="size-4" />
              )}
              {`${OBJECTIVE_LABELS[key]}: ${o.met ? 'met' : 'not met'}`}
            </p>
            <dl className="mt-2 space-y-1 text-foreground">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Result</dt>
                <dd className="font-medium tabular-nums">
                  {o.value === null ? MISSING : formatPercent(o.value)}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Target</dt>
                <dd className="tabular-nums">{`at least ${formatPercent(o.target)}`}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Portfolio</dt>
                <dd className="tabular-nums">{formatMetric(o.portfolio, format)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-muted-foreground">Nifty 50</dt>
                <dd className="tabular-nums">{formatMetric(o.benchmark, format)}</dd>
              </div>
            </dl>
            {o.reason && <p className="mt-2 text-foreground">{o.reason}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{o.rule}</p>
          </ToneBox>
        );
      })}
    </div>
  );
}

export function EquitySection({ results }: { results: PortfolioBacktestResults }) {
  const lines = useMemo(
    () =>
      seriesIn(results).map((key) => ({
        key,
        label: SERIES_LABELS[key],
        points: seriesPoints(results, key),
        dashed: key !== 'portfolio',
      })),
    [results],
  );
  const drawdowns = useMemo(
    () =>
      seriesIn(results).map((key) => ({
        key,
        label: SERIES_LABELS[key],
        points: seriesPoints(results, key, 'drawdowns'),
        dashed: key !== 'portfolio',
      })),
    [results],
  );
  return (
    <>
      <Section
        id="pb-equity"
        title="Value over time"
        description="The portfolio against Nifty 50 bought and held and the equal-weight portfolio, from the same capital, on Nifty 50's NSE trading days."
      >
        <LinesChart lines={lines} label="Portfolio value against the benchmarks" />
      </Section>
      <Section
        id="pb-drawdown"
        title="Drawdown"
        description="Fall from the running peak of each line."
      >
        <LinesChart lines={drawdowns} label="Drawdowns" percent />
      </Section>
    </>
  );
}

export function WeightsSection({ results }: { results: PortfolioBacktestResults }) {
  const rows = useMemo(() => weightRows(results), [results]);
  const strategies = useMemo(
    () => strategyOrder(results).map((id) => ({ id, name: results.strategy_names[id] ?? id })),
    [results],
  );
  return (
    <Section
      id="pb-weights"
      title="Weights"
      description="The weights set on each rebalance day; between rebalances the holdings drift with prices."
    >
      <WeightsChart rows={rows} strategies={strategies} label="Weights at each rebalance" />
    </Section>
  );
}

function MetricCell(props: {
  value: number | null | undefined;
  format: Parameters<typeof formatMetric>[1];
  reason?: string;
}) {
  return (
    <td className="py-2 pr-3 text-right tabular-nums" title={props.reason}>
      {formatMetric(props.value, props.format)}
    </td>
  );
}

/** Each line's metrics, as the backend computed them (results_analytics.risk_metrics). */
export function MetricsTable({ results }: { results: PortfolioBacktestResults }) {
  const keys = seriesIn(results);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">Performance metrics</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Metric</th>
            {keys.map((key) => (
              <th key={key} className="py-2 pr-3 text-right font-medium">
                {SERIES_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
                {row.label}
              </th>
              {keys.map((key) => (
                <MetricCell
                  key={key}
                  value={results.metrics[key]?.[row.key]}
                  format={row.format}
                  reason={results.null_reasons[key]?.[row.key]}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The portfolio's daily returns against Nifty 50's. */
export function RelativeTable({ results }: { results: PortfolioBacktestResults }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <caption className="sr-only">Against Nifty 50</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Measure</th>
            <th className="py-2 pr-3 text-right font-medium">Value</th>
            <th className="py-2 font-medium">Meaning</th>
          </tr>
        </thead>
        <tbody>
          {RELATIVE_ROWS.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-muted-foreground">
                {row.label}
              </th>
              <MetricCell
                value={results.relative[row.key]}
                format={row.format}
                reason={results.relative_null_reasons[row.key]}
              />
              <td className="py-2 text-xs text-muted-foreground">
                {results.relative_null_reasons[row.key] ?? row.hint}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notes({ entry, names }: { entry: RebalanceEntry; names: Record<string, string> }) {
  const items: string[] = [];
  if (entry.note) items.push(entry.note);
  for (const s of entry.strategies) if (s.excluded) items.push(`${s.name}: ${s.excluded}`);
  for (const b of entry.binding_limits) {
    const who = b.affected.length ? ` (${affectedNames(b.affected, names).join(', ')})` : '';
    items.push(`${b.detail}${who}`);
  }
  if (items.length === 0) return <span className="text-muted-foreground">{MISSING}</span>;
  return (
    <details className="max-w-md text-xs">
      <summary className="cursor-pointer whitespace-nowrap text-muted-foreground hover:text-foreground">
        {`${items.length} ${items.length === 1 ? 'note' : 'notes'}`}
      </summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((text, i) => (
          <li key={i}>{text}</li>
        ))}
      </ul>
    </details>
  );
}

/** Every rebalance: the regime of the day, the weights set, cash, turnover and cost. */
export function RebalanceLog({ results }: { results: PortfolioBacktestResults }) {
  const theme = useTheme();
  const names = results.strategy_names;
  const columns = useMemo<ColumnDef<RebalanceEntry>[]>(() => {
    const ids = strategyOrder(results);
    return [
      {
        id: 'day',
        header: 'Day',
        accessorFn: (r) => r.day,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDate(row.original.day)}</span>
        ),
        meta: { csv: (r: RebalanceEntry) => r.day },
      },
      {
        id: 'regime',
        header: 'Regime',
        accessorFn: (r) => r.regime?.code ?? '',
        cell: ({ row }) => {
          const regime = row.original.regime;
          return regime ? (
            <span
              className="inline-flex items-center gap-1.5 whitespace-nowrap"
              title={`As of ${formatDate(regime.as_of)}`}
            >
              <RegimeChip code={regime.code} /> {regime.name}
            </span>
          ) : (
            <span className="text-muted-foreground">{MISSING}</span>
          );
        },
        meta: { csv: (r: RebalanceEntry) => r.regime?.code ?? '' },
      },
      ...ids.map(
        (id, i): ColumnDef<RebalanceEntry> => ({
          id: `w-${id}`,
          header: () => (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-sm"
                style={{ backgroundColor: sleeveColor(i, theme) }}
              />
              {names[id]}
            </span>
          ),
          accessorFn: (r) => r.strategies.find((s) => s.strategy_id === id)?.weight ?? 0,
          cell: ({ getValue }) => formatPercent(getValue() as number),
          meta: {
            align: 'right',
            csvHeader: `${names[id]} weight`,
            csv: (r: RebalanceEntry) => r.strategies.find((s) => s.strategy_id === id)?.weight ?? 0,
          },
        }),
      ),
      {
        id: 'cash',
        header: 'Cash',
        accessorFn: (r) => r.cash_weight,
        cell: ({ getValue }) => formatPercent(getValue() as number),
        meta: { align: 'right', csv: (r: RebalanceEntry) => r.cash_weight },
      },
      {
        id: 'turnover',
        header: 'Turnover',
        accessorFn: (r) => r.turnover,
        cell: ({ getValue }) => formatPercent(getValue() as number),
        meta: { align: 'right', csv: (r: RebalanceEntry) => r.turnover },
      },
      {
        id: 'cost',
        header: 'Cost',
        accessorFn: (r) => r.cost,
        cell: ({ getValue }) => formatINR(getValue() as number),
        meta: { align: 'right', csv: (r: RebalanceEntry) => r.cost },
      },
      {
        id: 'value',
        header: 'Value after',
        accessorFn: (r) => r.value_after,
        cell: ({ getValue }) => formatINR(getValue() as number),
        meta: { align: 'right', csv: (r: RebalanceEntry) => r.value_after },
      },
      {
        id: 'notes',
        header: 'Notes',
        enableSorting: false,
        cell: ({ row }) => <Notes entry={row.original} names={names} />,
      },
    ];
  }, [names, results, theme]);
  return (
    <DataTable
      caption="Rebalance log"
      columns={columns}
      data={results.rebalances}
      pageSize={25}
      csvFileName="rebalance-log.csv"
    />
  );
}

/** The strategies and how each sleeve was backtested. */
export function SleevesTable(props: {
  detail: PortfolioBacktestDetail;
  results: PortfolioBacktestResults | undefined;
}) {
  const trades = new Map((props.results?.sleeves ?? []).map((s) => [s.strategy_id, s]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">Strategies in the portfolio</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Strategy</th>
            <th className="py-2 pr-3 font-medium">Template</th>
            <th className="py-2 pr-3 font-medium">Instrument</th>
            <th className="py-2 pr-3 text-right font-medium">Trades in period</th>
            <th className="py-2 font-medium">From backtest</th>
          </tr>
        </thead>
        <tbody>
          {props.detail.strategies.map((s) => (
            <tr key={s.strategy_id} className="border-b last:border-0">
              <td className="py-2 pr-3">
                <Link
                  to={`/app/strategies/${s.strategy_id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {s.name}
                </Link>
                {s.validation && (
                  <ValidationBadge validation={s.validation} className="mt-1 flex w-fit" />
                )}
              </td>
              <td className="py-2 pr-3">{coreInfo(s.strategy_key).name}</td>
              <td className="py-2 pr-3">{s.symbol}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {trades.get(s.strategy_id)?.trades ?? MISSING}
              </td>
              <td className="py-2">
                <Link
                  to={`/app/executions/${s.source_backtest_id}/results`}
                  className="text-primary hover:underline"
                >
                  Results
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The run's settings, as stored. */
export function SettingsList({ detail }: { detail: PortfolioBacktestDetail }) {
  const l = detail.limits;
  return (
    <dl className="divide-y text-sm">
      <Row label="Period">{`${formatDate(detail.start_date)} to ${formatDate(detail.end_date)}`}</Row>
      <Row label="Rebalancing">{frequencyLabel(detail.frequency)}</Row>
      <Row label="Benchmark">{`${detail.benchmark_symbol ?? 'Deleted instrument'} (price index, buy and hold)`}</Row>
      <Row label="Capital">{formatINR(detail.capital)}</Row>
      <Row label="Rebalancing cost">
        {`Brokerage ${formatPercent(detail.brokerage_rate)} + slippage ${detail.slippage_bps} bps of the traded value`}
      </Row>
      <Row label="Risk limits">
        {`Cash reserve ${formatPercent(l.cash_reserve ?? 0)}, at most ${formatPercent(l.max_strategy_weight ?? 1)} per strategy, at most ${formatPercent(l.max_asset_weight ?? 1)} per instrument`}
      </Row>
      <Row label="Regime filter">
        {detail.regime_filter && detail.regime_model
          ? `On: ${detail.regime_model.name} (${detail.regime_model.kind_name}) on ${detail.regime_model.instrument_symbol ?? 'a deleted instrument'}`
          : 'Off'}
      </Row>
      <Row label="60/40 benchmark">{detail.sixty_forty ? 'Shown' : 'Not shown'}</Row>
      <Row label="Validation">
        {detail.require_validated
          ? 'Only strategies with a passing validation of their current version'
          : 'Not required'}
      </Row>
    </dl>
  );
}

/** How the numbers were made: the price-index note and the others the backend gives. */
export function NotesList({ results }: { results: PortfolioBacktestResults }) {
  return (
    <div className="space-y-3 text-sm">
      {results.regime_in_sample?.flag && (
        <p role="note" className="flex items-start gap-1.5 font-medium text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {results.regime_in_sample.flag}
        </p>
      )}
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {results.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
