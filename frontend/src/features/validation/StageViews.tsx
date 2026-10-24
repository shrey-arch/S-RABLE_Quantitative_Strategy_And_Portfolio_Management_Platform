import { CircleCheck, CircleDashed, CircleX, Loader2, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Row, Section } from '@/features/results/parts';
import { toChartPoints } from '@/features/results/results-model';
import { EquityChart } from '@/features/results/ResultsCharts';
import { istDate } from '@/features/instruments/market-data';
import { formatDate, formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  GroupedBarChart,
  HistogramChart,
  RegimeEquityChart,
  WindowTimeline,
} from './ValidationCharts';
import { ModelRegimeStage } from './ModelRegimeStage';
import { RegimeCards } from './RegimeCards';
import {
  histogramBars,
  moneyOrMissing,
  percentOrMissing,
  ratioOrMissing,
  ruleText,
  STAGE_STATUS_LABELS,
  STAGE_STATUS_TONES,
  unitText,
  type Check,
  type RegimeModelRef,
  type StageStatus,
  type Stages,
  type Tone,
  type ValidationReport,
} from './validation-model';

const TONE_CLASSES: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-info/30 bg-info/10 text-info',
  neutral: 'border-border bg-muted text-muted-foreground',
};

const STATUS_ICON: Record<StageStatus, React.ReactNode> = {
  NOT_RUN: <CircleDashed aria-hidden className="size-3.5" />,
  RUNNING: <Loader2 aria-hidden className="size-3.5 animate-spin" />,
  PASS: <CircleCheck aria-hidden className="size-3.5" />,
  FAIL: <CircleX aria-hidden className="size-3.5" />,
  ERROR: <TriangleAlert aria-hidden className="size-3.5" />,
  PLANNED: <CircleDashed aria-hidden className="size-3.5" />,
};

/** A stage's status as the backend reports it (the text carries the meaning). */
export function StageStatusBadge(props: { status: StageStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[STAGE_STATUS_TONES[props.status]],
      )}
    >
      {STATUS_ICON[props.status]}
      {STAGE_STATUS_LABELS[props.status]}
    </span>
  );
}

export function ToneBox(props: { tone: Tone; children: React.ReactNode; label?: string }) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className={cn('rounded-xl border p-4 text-sm sm:p-5', TONE_CLASSES[props.tone])}
    >
      {props.children}
    </div>
  );
}

/** The stage's checks: the backend's rule, the value it was applied to, and the result. */
export function ChecksTable(props: { checks: Check[]; caption: string }) {
  if (props.checks.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="sr-only">{props.caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Check</th>
            <th className="py-2 pr-3 font-medium">Rule</th>
            <th className="py-2 pr-3 text-right font-medium">Value</th>
            <th className="py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {props.checks.map((check) => (
            <tr key={check.id} className="border-b last:border-0 align-top">
              <td className="py-2 pr-3">
                <p className="font-medium">{check.label}</p>
                <p className="text-xs text-muted-foreground">{check.explanation}</p>
              </td>
              <td className="py-2 pr-3 whitespace-nowrap">{ruleText(check)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {unitText(check.unit, check.value)}
                {check.value === null && check.reason && (
                  <p className="text-xs text-muted-foreground">{check.reason}</p>
                )}
              </td>
              <td className="py-2">
                <StageStatusBadge status={check.passed ? 'PASS' : 'FAIL'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type AnyStage = Stages[keyof Stages];

/** The stage's verdict card: status, the backend's reason, and its checks. */
export function StageVerdict(props: { stage: AnyStage; source: string }) {
  const { stage } = props;
  return (
    <Section
      id={`verdict-${stage.key}`}
      title={`${stage.name}: verdict`}
      description={`Thresholds from ${props.source}, as returned by the backend.`}
      actions={<StageStatusBadge status={stage.status} />}
    >
      {stage.reason && <p className="text-sm">{stage.reason}</p>}
      {stage.error && (
        <p role="alert" className="text-sm text-destructive">
          {stage.error}
        </p>
      )}
      <ChecksTable checks={stage.checks} caption={`${stage.name} checks`} />
    </Section>
  );
}

/** Shown in a stage's tab until the stage has finished. */
function NotYet(props: { stage: AnyStage }) {
  const text =
    props.stage.status === 'RUNNING'
      ? 'This stage is running. Its results appear here when it finishes.'
      : props.stage.status === 'ERROR'
        ? 'This stage could not run, so it has no results.'
        : (props.stage.reason ?? 'This stage has not run yet.');
  return <p className="rounded-md border bg-muted/50 p-3 text-sm">{text}</p>;
}

const done = (status: StageStatus) => status === 'PASS' || status === 'FAIL';

function Tile(props: { label: string; value: string; note?: string }) {
  return (
    <div role="group" aria-label={props.label} className="rounded-lg border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{props.label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{props.value}</p>
      {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
    </div>
  );
}

// --- stage 1 ---------------------------------------------------------------------------

export function BacktestStageView({ report }: { report: ValidationReport }) {
  const stage = report.stages.backtest;
  const equity = useMemo(
    () =>
      toChartPoints(
        stage.equity_curve,
        (p) => p.timestamp,
        (p) => p.portfolio_value,
      ),
    [stage.equity_curve],
  );
  return (
    <div className="space-y-6">
      <StageVerdict stage={stage} source={report.thresholds_source} />
      {!done(stage.status) || !stage.metrics ? (
        <NotYet stage={stage} />
      ) : (
        <>
          <Section
            id="backtest-metrics"
            title="Historical backtest"
            description="The whole range, with the costs set for the run."
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Final capital" value={formatINR(stage.metrics.final_capital)} />
              <Tile label="Total return" value={formatPercent(stage.metrics.total_return)} />
              <Tile
                label="CAGR"
                value={percentOrMissing(stage.metrics.cagr)}
                note={stage.metrics.cagr === null ? stage.null_reasons.cagr : undefined}
              />
              <Tile
                label="Sharpe ratio"
                value={ratioOrMissing(stage.metrics.sharpe_ratio)}
                note={
                  stage.metrics.sharpe_ratio === null ? stage.null_reasons.sharpe_ratio : undefined
                }
              />
              <Tile label="Max drawdown" value={percentOrMissing(stage.metrics.max_drawdown)} />
              <Tile
                label="Volatility"
                value={percentOrMissing(stage.metrics.annualized_volatility)}
              />
              <Tile label="Fills" value={formatNumber(stage.metrics.trade_count, 0)} />
              <Tile label="Daily bars" value={formatNumber(stage.metrics.bars, 0)} />
            </div>
            <EquityChart
              strategy={equity}
              benchmark={null}
              benchmarkLabel=""
              label={`Equity curve of the validation backtest, ${equity.length} days`}
            />
          </Section>
          <Section id="backtest-years" title="Calendar years (IST)">
            <table className="w-full max-w-md text-sm">
              <caption className="sr-only">Return of each calendar year</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Year</th>
                  <th className="py-2 text-right font-medium">Return</th>
                </tr>
              </thead>
              <tbody>
                {stage.yearly_returns.map((y) => (
                  <tr key={y.year} className="border-b last:border-0">
                    <td className="py-1.5">{y.year}</td>
                    <td
                      className={cn(
                        'py-1.5 text-right tabular-nums',
                        y.return > 0 ? 'text-success' : y.return < 0 ? 'text-destructive' : '',
                      )}
                    >
                      {formatPercent(y.return)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  );
}

// --- stage 2 ---------------------------------------------------------------------------

export function WalkForwardStageView({ report }: { report: ValidationReport }) {
  const stage = report.stages.walk_forward;
  const windows = stage.windows;
  const summary = stage.summary;
  const categories = windows.map((w) => `W${w.index}`);
  return (
    <div className="space-y-6">
      <StageVerdict stage={stage} source={report.thresholds_source} />
      {!done(stage.status) || !summary || !stage.settings ? (
        <NotYet stage={stage} />
      ) : (
        <>
          <Section
            id="wf-summary"
            title="Aggregate and stability"
            description={stage.settings.selection}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Windows" value={formatNumber(summary.window_count, 0)} />
              <Tile
                label="Retention"
                value={percentOrMissing(summary.retention)}
                note={
                  summary.retention === null ? (summary.retention_reason ?? undefined) : undefined
                }
              />
              <Tile
                label="Mean in-sample return (a year)"
                value={percentOrMissing(summary.mean_in_sample_return)}
              />
              <Tile
                label="Mean out-of-sample return (a year)"
                value={percentOrMissing(summary.mean_out_of_sample_return)}
              />
              <Tile
                label="Mean in-sample Sharpe"
                value={ratioOrMissing(summary.mean_in_sample_sharpe)}
              />
              <Tile
                label="Mean out-of-sample Sharpe"
                value={ratioOrMissing(summary.mean_out_of_sample_sharpe)}
              />
              <Tile
                label="Positive test windows"
                value={formatPercent(summary.positive_test_window_rate)}
              />
              <Tile
                label="Test return: mean / median / std"
                value={`${formatPercent(summary.mean_test_return)} / ${formatPercent(summary.median_test_return)} / ${formatPercent(summary.test_return_std)}`}
              />
            </div>
            {summary.parameter_stability.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Parameter stability</h3>
                <table className="w-full max-w-lg text-sm">
                  <caption className="sr-only">How often each parameter value was chosen</caption>
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 font-medium">Chosen value</th>
                      <th className="py-2 text-right font-medium">Windows</th>
                      <th className="py-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.parameter_stability.map((p) => (
                      <tr key={p.choice} className="border-b last:border-0">
                        <td className="py-1.5 font-mono text-xs">{p.choice}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.windows}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatPercent(p.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            id="wf-timeline"
            title="Window timeline"
            description={`Train ${stage.settings.train_bars}, validation ${stage.settings.validation_bars} and test ${stage.settings.test_bars} bars, moving ${stage.settings.step_bars} bars per window.`}
          >
            <WindowTimeline windows={windows} label={`Walk-forward windows, ${windows.length}`} />
          </Section>

          <Section
            id="wf-charts"
            title="In-sample against out-of-sample"
            description="In-sample is the validation span the parameters were chosen on; out-of-sample is the next test span."
          >
            <GroupedBarChart
              label="Annualised mean return by window, in-sample and out-of-sample"
              categories={categories}
              series={[
                {
                  name: 'In-sample return',
                  values: windows.map((w) => w.in_sample.annualized_mean_return),
                },
                {
                  name: 'Out-of-sample return',
                  values: windows.map((w) => w.out_of_sample.annualized_mean_return),
                },
              ]}
              format={(v) => formatPercent(v)}
            />
            <GroupedBarChart
              label="Sharpe ratio by window, in-sample and out-of-sample"
              categories={categories}
              series={[
                { name: 'In-sample Sharpe', values: windows.map((w) => w.in_sample.sharpe_ratio) },
                {
                  name: 'Out-of-sample Sharpe',
                  values: windows.map((w) => w.out_of_sample.sharpe_ratio),
                },
              ]}
              format={(v) => formatNumber(v, 2)}
            />
          </Section>

          <Section id="wf-windows" title="Windows">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <caption className="sr-only">Walk-forward windows</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Window</th>
                    <th className="py-2 pr-2 font-medium">Validation span</th>
                    <th className="py-2 pr-2 font-medium">Test span</th>
                    <th className="py-2 pr-2 font-medium">Parameters</th>
                    <th className="py-2 pr-2 text-right font-medium">In-sample return</th>
                    <th className="py-2 pr-2 text-right font-medium">Out-of-sample return</th>
                    <th className="py-2 pr-2 text-right font-medium">In-sample Sharpe</th>
                    <th className="py-2 pr-2 text-right font-medium">Out-of-sample Sharpe</th>
                    <th className="py-2 text-right font-medium">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {windows.map((w) => {
                    const params = Object.entries(w.parameters);
                    return (
                      <tr key={w.index} className="border-b last:border-0 align-top">
                        <td className="py-1.5 pr-2">{w.index}</td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {formatDate(istDate(w.validation_start))} to{' '}
                          {formatDate(istDate(w.validation_end))}
                        </td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {formatDate(istDate(w.test_start))} to {formatDate(istDate(w.test_end))}
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-xs whitespace-nowrap">
                          {params.length === 0
                            ? 'As saved'
                            : params.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {percentOrMissing(w.in_sample.annualized_mean_return)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {percentOrMissing(w.out_of_sample.annualized_mean_return)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {ratioOrMissing(w.in_sample.sharpe_ratio)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {ratioOrMissing(w.out_of_sample.sharpe_ratio)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {w.retention === null ? (
                            <span title={w.retention_reason ?? undefined}>{MISSING}</span>
                          ) : (
                            formatPercent(w.retention)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Returns are annualised mean daily returns of each span. Retention is out-of-sample as
              a share of in-sample; it is not defined when the in-sample return is not positive.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}

// --- stage 3 ---------------------------------------------------------------------------

export function RegimeStageView({ report }: { report: ValidationReport }) {
  const stage = report.stages.regime_stress;
  const backtest = report.stages.backtest;
  const equity = useMemo(
    () =>
      toChartPoints(
        backtest.equity_curve,
        (p) => p.timestamp,
        (p) => p.portfolio_value,
      ),
    [backtest.equity_curve],
  );
  const names = Object.fromEntries(stage.regimes.map((r) => [r.key, r.name]));
  const observed = stage.regimes.filter((r) => r.days > 0);
  return (
    <div className="space-y-6">
      <StageVerdict stage={stage} source={report.thresholds_source} />
      {!done(stage.status) || !stage.method ? (
        <NotYet stage={stage} />
      ) : stage.method.source === 'model' ? (
        <ModelRegimeStage report={report} />
      ) : (
        <>
          <Section id="regime-method" title="How the regimes were found">
            <p className="text-sm">{stage.method.method}</p>
            <p className="text-xs text-muted-foreground">
              {`${formatNumber(stage.labelled_days, 0)} days have a regime; the first ${formatNumber(stage.method.warm_up_bars, 0)} days are warm-up (no regime yet).`}
            </p>
          </Section>
          <Section id="regime-table" title="Performance by regime">
            <RegimeCards rows={stage.regimes} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <caption className="sr-only">Performance by regime</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Regime</th>
                    <th className="py-2 pr-2 text-right font-medium">Days</th>
                    <th className="py-2 pr-2 text-right font-medium">Share</th>
                    <th className="py-2 pr-2 text-right font-medium">Return</th>
                    <th className="py-2 pr-2 text-right font-medium">Mean return (a year)</th>
                    <th className="py-2 pr-2 text-right font-medium">Volatility</th>
                    <th className="py-2 pr-2 text-right font-medium">Max drawdown</th>
                    <th className="py-2 text-right font-medium">Fills</th>
                  </tr>
                </thead>
                <tbody>
                  {stage.regimes.map((r) => (
                    <tr key={r.key} className="border-b last:border-0">
                      <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatNumber(r.days, 0)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatPercent(r.share)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {percentOrMissing(r.total_return)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {percentOrMissing(r.annualized_mean_return)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {percentOrMissing(r.annualized_volatility)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {percentOrMissing(r.max_drawdown)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatNumber(r.trade_count, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {observed.length < stage.regimes.length && (
              <p className="text-xs text-muted-foreground">
                A regime with no days did not occur in this range.
              </p>
            )}
            <GroupedBarChart
              label="Return and maximum drawdown by regime"
              categories={observed.map((r) => r.name)}
              series={[
                { name: 'Return', values: observed.map((r) => r.total_return) },
                {
                  name: 'Max drawdown',
                  values: observed.map((r) => (r.max_drawdown === null ? null : -r.max_drawdown)),
                },
              ]}
              format={(v) => formatPercent(v)}
            />
          </Section>
          <Section
            id="regime-equity"
            title="Equity curve by regime"
            description="The validation backtest's equity; each day is shaded by its regime."
          >
            <RegimeEquityChart
              equity={equity}
              periods={stage.periods}
              names={names}
              label={`Equity curve with ${stage.periods.length} regime periods shaded`}
            />
          </Section>
        </>
      )}
    </div>
  );
}

// --- stage 4 ---------------------------------------------------------------------------

function DistributionRows(props: {
  title: string;
  d: {
    mean: number;
    median: number;
    percentiles: Record<'p05' | 'p25' | 'p50' | 'p75' | 'p95', number>;
  };
  format: (v: number) => string;
}) {
  const p = props.d.percentiles;
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-1.5 pr-2 text-left font-medium">
        {props.title}
      </th>
      {[props.d.mean, props.d.median, p.p05, p.p25, p.p50, p.p75, p.p95].map((v, i) => (
        <td key={i} className="py-1.5 pr-2 text-right tabular-nums">
          {props.format(v)}
        </td>
      ))}
    </tr>
  );
}

export function MonteCarloStageView({ report }: { report: ValidationReport }) {
  const stage = report.stages.monte_carlo;
  const b = stage.bootstrap;
  const s = stage.significance;
  return (
    <div className="space-y-6">
      <StageVerdict stage={stage} source={report.thresholds_source} />
      {!done(stage.status) || !b || !s ? (
        <NotYet stage={stage} />
      ) : (
        <>
          <Section
            id="mc-bootstrap"
            title="Range of outcomes (bootstrap)"
            description={`${stage.resampled_series} ${formatNumber(b.simulations, 0)} simulations of ${formatNumber(b.periods, 0)} days, seed ${b.seed}.`}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Mean return" value={formatPercent(b.cumulative_return.mean)} />
              <Tile label="Median return" value={formatPercent(b.cumulative_return.median)} />
              <Tile
                label="90% of outcomes"
                value={`${formatPercent(b.cumulative_return.simulated_outcome_interval_90[0])} to ${formatPercent(b.cumulative_return.simulated_outcome_interval_90[1])}`}
              />
              <Tile
                label="Probability of loss"
                value={formatPercent(b.cumulative_return.probability_of_loss)}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">Distribution of the simulated outcomes</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2 font-medium">Outcome</th>
                    {['Mean', 'Median', '5th', '25th', '50th', '75th', '95th'].map((h) => (
                      <th key={h} className="py-2 pr-2 text-right font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <DistributionRows
                    title="Return"
                    d={b.cumulative_return}
                    format={(v) => formatPercent(v)}
                  />
                  <DistributionRows
                    title="Final value"
                    d={b.final_value}
                    format={(v) => formatINR(v)}
                  />
                  <DistributionRows
                    title="Max drawdown"
                    d={b.maximum_drawdown}
                    format={(v) => formatPercent(v)}
                  />
                </tbody>
              </table>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Simulated returns</h3>
                <HistogramChart
                  label={`Histogram of ${b.simulations} simulated returns`}
                  histogram={b.histograms.cumulative_return}
                  format={(v) => formatPercent(v)}
                  markers={[
                    { label: '5th', value: b.cumulative_return.percentiles.p05 },
                    { label: '50th', value: b.cumulative_return.percentiles.p50 },
                    { label: '95th', value: b.cumulative_return.percentiles.p95 },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Simulated maximum drawdowns</h3>
                <HistogramChart
                  label={`Histogram of ${b.simulations} simulated maximum drawdowns`}
                  histogram={b.histograms.maximum_drawdown}
                  format={(v) => formatPercent(v)}
                  markers={[
                    { label: '50th', value: b.maximum_drawdown.percentiles.p50 },
                    { label: '95th', value: b.maximum_drawdown.percentiles.p95 },
                  ]}
                />
              </div>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Bins of the histograms (
                {histogramBars(b.histograms.cumulative_return, () => '').length})
              </summary>
              <ul className="mt-2 columns-2 text-xs tabular-nums sm:columns-3">
                {histogramBars(
                  b.histograms.cumulative_return,
                  (from, to) => `${formatPercent(from)} to ${formatPercent(to)}`,
                ).map((bar) => (
                  <li key={bar.label}>
                    {bar.label}: {bar.value}
                  </li>
                ))}
              </ul>
            </details>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {b.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Section>

          <Section id="mc-significance" title="Statistical significance">
            <dl className="divide-y text-sm">
              <Row label="Test">{s.test.replace(/_/g, ' ')}</Row>
              <Row label="Null hypothesis">{s.null_hypothesis}</Row>
              <Row label="Alternative">{s.alternative_hypothesis}</Row>
              <Row label="Observed mean daily return">{formatPercent(s.observed_mean_return)}</Row>
              <Row label="Permutations">{formatNumber(s.permutations, 0)}</Row>
              <Row label="Seed">{s.seed}</Row>
              <Row label="p-value">{formatNumber(s.p_value, 4)}</Row>
            </dl>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {s.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

// --- configuration ---------------------------------------------------------------------

/** The regime model a model-source validation used, as recorded at submit time. */
function RecordedModel({ model }: { model: RegimeModelRef | undefined }) {
  if (!model) return <>Market regime model</>;
  return (
    <span>
      {'Market regime model: '}
      <Link
        to={`/app/regime?tab=model&model=${model.id}`}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {`${model.name} (${model.version})`}
      </Link>
      {`, ${model.kind_name}, on ${model.instrument_symbol ?? 'a deleted instrument'}`}
      {model.training_start && model.training_end
        ? `, trained ${formatDate(istDate(model.training_start))} to ${formatDate(istDate(model.in_sample_end ?? model.training_end))}`
        : ''}
      {model.random_state !== null && model.random_state !== undefined
        ? `, seed ${model.random_state}`
        : ''}
    </span>
  );
}

export function ConfigurationView(props: {
  report: ValidationReport;
  symbol: (id: string) => string;
  rules: React.ReactNode;
}) {
  const { report } = props;
  const c = report.configuration;
  const wf = c.walk_forward as Record<string, unknown>;
  const regimes = c.regimes as Record<string, unknown>;
  const mc = c.monte_carlo as Record<string, unknown>;
  const grid = Object.entries((wf.parameter_grid ?? {}) as Record<string, number[]>);
  const params = Object.entries(c.parameters);
  const p = report.data_provenance as Record<string, unknown> | null;
  return (
    <div className="space-y-6">
      <Section
        id="reproducibility"
        title="Reproducibility"
        description="The same settings, seed and stored data give the same results."
      >
        <dl className="divide-y text-sm">
          <Row label="Monte Carlo seed">{String(mc.seed ?? MISSING)}</Row>
          <Row label="Simulations">{formatNumber(mc.simulations as number, 0)}</Row>
          <Row label="Data fingerprint">
            <code className="font-mono text-xs break-all">
              {String(p?.data_fingerprint ?? MISSING)}
            </code>
          </Row>
          <Row label="Daily bars">{formatNumber(report.bars, 0)}</Row>
          <Row label="Data provider">{String(p?.provider ?? MISSING)}</Row>
          <Row label="Engine version">{c.engine_version ?? MISSING}</Row>
          <Row label="Validation version">{c.validation_version ?? MISSING}</Row>
          <Row label="Strategy version">
            {c.strategy_version === null ? MISSING : `v${c.strategy_version} at the run`}
            {c.current_strategy_version !== null &&
            c.current_strategy_version !== c.strategy_version
              ? ` (now v${c.current_strategy_version})`
              : ''}
          </Row>
        </dl>
      </Section>
      <Section id="validation-config" title="Configuration">
        <dl className="divide-y text-sm">
          <Row label="Strategy">{c.strategy_name ?? 'Deleted strategy'}</Row>
          {c.rules ? (
            <Row label="Rules (at the run)">{props.rules}</Row>
          ) : (
            <Row label="Parameters">
              {params.length === 0 ? (
                'Template defaults'
              ) : (
                <span className="font-mono text-xs">
                  {params.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}
                </span>
              )}
            </Row>
          )}
          <Row label={c.instrument_ids.length > 1 ? 'Instruments' : 'Instrument'}>
            {c.instrument_ids.map(props.symbol).join(', ')}
          </Row>
          <Row label="Dates">
            {c.requested_start ? formatDate(istDate(c.requested_start)) : 'All stored data'} to{' '}
            {c.requested_end ? formatDate(istDate(c.requested_end)) : 'the last stored bar'}
          </Row>
          <Row label="Initial capital">{moneyOrMissing(c.initial_capital)}</Row>
          <Row label="Quantity per trade">{formatNumber(c.quantity, 0)}</Row>
          <Row label="Slippage">{`${formatNumber(c.slippage_bps, 2)} bps`}</Row>
          <Row label="Brokerage">{`${formatNumber((c.brokerage_rate ?? 0) * 100, 4)}% of trade value`}</Row>
          <Row label="Walk-forward">
            {`Train ${String(wf.train_bars)} + validation ${String(wf.validation_bars)} + test ${String(wf.test_bars)} bars, moving ${String(wf.step_bars)}`}
          </Row>
          <Row label="Parameter search">
            {grid.length === 0 ? (
              'None'
            ) : (
              <span className="font-mono text-xs">
                {grid.map(([k, values]) => `${k} in {${values.join(', ')}}`).join(', ')}
              </span>
            )}
          </Row>
          <Row label="Regimes">
            {regimes.source === 'model' ? (
              <RecordedModel model={regimes.model as RegimeModelRef | undefined} />
            ) : (
              `Rule-based: ${String(regimes.trend_window)}-day trend average, ${String(regimes.volatility_window)}-day volatility`
            )}
          </Row>
          <Row label="Run id">
            <code className="font-mono text-xs">{report.id}</code>
          </Row>
        </dl>
      </Section>
      <Section id="thresholds" title="Thresholds" description={`From ${report.thresholds_source}.`}>
        <ul className="space-y-1 text-sm">
          {report.thresholds.map((t) => (
            <li key={`${t.stage}-${t.id}`}>
              <span className="text-muted-foreground">{t.stage.replace(/_/g, ' ')}: </span>
              {ruleText(t)}
            </li>
          ))}
        </ul>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {report.basis.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
