import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Row, Section } from '@/features/results/parts';
import { istDate } from '@/features/instruments/market-data';
import { formatDate, formatDateTime, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { SupervisedCardView } from './SupervisedCardView';
import { ClassChip, DimensionChart, RegimeChart, RegimeChip } from './RegimeChart';
import {
  classColor,
  classificationText,
  codeColor,
  modelName,
  type DimensionPeriods,
  type DimensionReading,
  type SupervisedCard,
  type CurrentRegime,
  type ModelCard,
  type RegimeHistory,
  type RegimeLabel,
  type RegimeModelDetail,
} from './regime-model';

/**
 * The label every regime view carries: a Gaussian mixture's classification
 * describes the past; a supervised model's classifies the next days, which is not
 * a guarantee.
 */
export function ClassificationLabel({ horizon }: { horizon?: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
      <Compass aria-hidden className="size-3.5" />
      {classificationText(horizon)}
    </span>
  );
}

const day = (timestamp: string) => formatDate(istDate(timestamp));

function DimensionRow({ d }: { d: DimensionReading }) {
  const theme = useTheme();
  return (
    <li className="space-y-1.5 rounded-lg border bg-background p-3" aria-label={d.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{d.name}</span>
        <span className="flex items-center gap-2 text-sm">
          <ClassChip label={d.label} />
          <span className="tabular-nums">{formatPercent(d.probability)}</span>
        </span>
      </div>
      <ul className="space-y-1" aria-label={`${d.name} probabilities`}>
        {d.probabilities.map((p) => (
          <li
            key={p.label}
            className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2 text-xs"
          >
            <span>{p.label}</span>
            <span className="h-1.5 rounded bg-muted" aria-hidden>
              <span
                className="block h-1.5 rounded"
                style={{
                  width: `${Math.max(0, Math.min(1, p.probability)) * 100}%`,
                  background: classColor(theme, p.label),
                }}
              />
            </span>
            <span className="text-right tabular-nums">{formatPercent(p.probability)}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** A supervised model's classification of the next days, one row per dimension. */
function SupervisedCurrent({ current }: { current: CurrentRegime }) {
  const r = current.regime;
  return (
    <Section
      id="current-regime"
      title="Current regime"
      description={current.statement}
      actions={<ClassificationLabel horizon={current.horizon_days} />}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <RegimeChip code={r.code} />
            <p className="text-xl font-semibold" data-testid="regime-name">
              {r.name}
            </p>
          </div>
          <dl className="divide-y text-sm">
            <Row label="Describes">{`The next ${current.horizon_days} trading days after ${day(current.as_of)}`}</Row>
            <Row label="Combined probability">
              <span className="tabular-nums">{formatPercent(current.confidence)}</span>
              <span className="text-muted-foreground">
                {' '}
                (the three dimensions&apos; probabilities multiplied)
              </span>
            </Row>
            <Row label="As of">{`${day(current.as_of)} (last stored daily bar)`}</Row>
            <Row label="Reference instrument">
              {current.instrument.id ? (
                <Link
                  to={`/app/instruments/${current.instrument.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {current.instrument.symbol}
                </Link>
              ) : (
                'Deleted instrument'
              )}
            </Row>
            <Row label="Model">
              <Link
                to={`/app/regime?tab=model&model=${current.model.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {modelName(current.model)}
              </Link>
              <span className="text-muted-foreground"> (accuracy on its model card)</span>
            </Row>
          </dl>
        </div>
        <ul className="space-y-3" aria-label="Regime dimensions">
          {(current.dimensions ?? []).map((d) => (
            <DimensionRow key={d.key} d={d} />
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** The active model's regime today, with its confidence and the other regimes' probabilities. */
export function CurrentRegimeCard({ current }: { current: CurrentRegime }) {
  const theme = useTheme();
  const r = current.regime;
  if (current.dimensions) return <SupervisedCurrent current={current} />;
  return (
    <Section
      id="current-regime"
      title="Current regime"
      description={current.statement}
      actions={<ClassificationLabel />}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <RegimeChip code={r.code} />
            <p className="text-xl font-semibold" data-testid="regime-name">
              {r.name}
            </p>
          </div>
          <dl className="divide-y text-sm">
            <Row label="Volatility state">{r.volatility_state}</Row>
            <Row label="Trend state">{r.trend_state}</Row>
            <Row label="Confidence">
              <span className="tabular-nums">{formatPercent(current.confidence)}</span>
              <span className="text-muted-foreground">
                {' '}
                (the model&apos;s probability for this regime)
              </span>
            </Row>
            <Row label="As of">{`${day(current.as_of)} (last stored daily bar)`}</Row>
            <Row label="Reference instrument">
              {current.instrument.id ? (
                <Link
                  to={`/app/instruments/${current.instrument.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {current.instrument.symbol}
                </Link>
              ) : (
                'Deleted instrument'
              )}
            </Row>
            <Row label="Model">{modelName(current.model)}</Row>
          </dl>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Probability of each regime on {day(current.as_of)}
          </h3>
          <ul className="space-y-2" aria-label="Regime probabilities">
            {current.probabilities.map((p) => (
              <li key={p.regime_id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <RegimeChip code={p.code} />
                    {p.name}
                  </span>
                  <span className="tabular-nums">{formatPercent(p.probability)}</span>
                </div>
                <div className="h-1.5 rounded bg-muted" aria-hidden>
                  <div
                    className="h-1.5 rounded"
                    style={{
                      width: `${Math.max(0, Math.min(1, p.probability)) * 100}%`,
                      background: codeColor(theme, p.code),
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

function Legend({ regimes, warmUp }: { regimes: RegimeLabel[]; warmUp: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Regimes">
      {regimes.map((r) => (
        <li key={r.code} className="flex items-center gap-1.5">
          <RegimeChip code={r.code} />
          {r.name}
        </li>
      ))}
      {warmUp && (
        <li className="flex items-center gap-1.5">
          <RegimeChip code="W" /> Warm-up (no regime yet)
        </li>
      )}
    </ul>
  );
}

/** Supervised: the closes with one band row per dimension, and each dimension's periods. */
function DimensionHistory(props: { history: RegimeHistory; dimensions: DimensionPeriods[] }) {
  const { history } = props;
  const symbol = history.instrument.symbol ?? 'the reference instrument';
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {`${symbol}, ${day(history.start)} to ${day(history.end)}: ${formatNumber(history.points.length, 0)} daily bars. Each band is the model's classification of the next ${history.horizon_days} days, made with what was known on that day. The model was trained on ${day(history.training_start)} to ${day(history.training_end)}.`}
      </p>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs" aria-label="Classes">
        {props.dimensions.map((d) => (
          <li key={d.key} className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{d.name}:</span>
            {d.classes.map((c) => (
              <ClassChip key={c} label={c} />
            ))}
          </li>
        ))}
      </ul>
      <DimensionChart
        history={history}
        dimensions={props.dimensions}
        label={`Closes of ${symbol} with ${props.dimensions.length} band rows: ${props.dimensions.map((d) => `${d.name} (${d.periods.length} periods)`).join(', ')}`}
      />
      {props.dimensions.map((d) => (
        <details key={d.key} className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {`${d.name}: every period (${d.periods.length})`}
          </summary>
          <div className="mt-2 max-h-80 overflow-auto rounded-md border">
            <table className="w-full min-w-[26rem] text-sm">
              <caption className="sr-only">{`${d.name} periods`}</caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Class</th>
                  <th className="px-2 py-2 font-medium">From</th>
                  <th className="px-2 py-2 font-medium">To</th>
                  <th className="px-2 py-2 text-right font-medium">Days</th>
                </tr>
              </thead>
              <tbody>
                {d.periods.map((p) => (
                  <tr key={p.start} className="border-b last:border-0">
                    <td className="px-2 py-1.5">
                      <ClassChip label={p.label} />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{day(p.start)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{day(p.end)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.bars}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

/** Price chart with labelled regime bands, the transitions and every period. */
export function HistoryView({ history }: { history: RegimeHistory }) {
  if (history.dimension_periods)
    return <DimensionHistory history={history} dimensions={history.dimension_periods} />;
  const warmUp = history.periods.some((p) => p.regime_id === null);
  const symbol = history.instrument.symbol ?? 'the reference instrument';
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {`${symbol}, ${day(history.start)} to ${day(history.end)}: ${formatNumber(history.points.length, 0)} daily bars in ${history.periods.length} ${history.periods.length === 1 ? 'period' : 'periods'}. The model was trained on ${day(history.training_start)} to ${day(history.training_end)}; days up to then were part of its training data.`}
      </p>
      <Legend regimes={history.regimes} warmUp={warmUp} />
      <RegimeChart
        history={history}
        label={`Closes of ${symbol} with ${history.periods.length} regime periods labelled`}
      />
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Transitions ({history.transitions.length})</h3>
        {history.transitions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No change of regime in this range.</p>
        ) : (
          <div className="max-h-80 overflow-auto rounded-md border">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Regime transitions</caption>
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">From</th>
                  <th className="px-2 py-2 font-medium">To</th>
                  <th className="px-2 py-2 text-right font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {[...history.transitions].reverse().map((t) => (
                  <tr key={t.timestamp} className="border-b last:border-0">
                    <td className="px-2 py-1.5 whitespace-nowrap">{day(t.timestamp)}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <RegimeChip code={t.from_code} /> {t.from_name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <RegimeChip code={t.to_code} /> {t.to_name}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatPercent(t.confidence)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Every period ({history.periods.length})
        </summary>
        <div className="mt-2 max-h-80 overflow-auto rounded-md border">
          <table className="w-full min-w-[30rem] text-sm">
            <caption className="sr-only">Regime periods</caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-2 py-2 font-medium">Regime</th>
                <th className="px-2 py-2 font-medium">From</th>
                <th className="px-2 py-2 font-medium">To</th>
                <th className="px-2 py-2 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {history.periods.map((p) => (
                <tr key={p.start} className="border-b last:border-0">
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <RegimeChip code={p.code ?? 'W'} /> {p.name}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{day(p.start)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{day(p.end)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{p.bars}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Everything about one trained model: what it is, what it learned from, how it did. */
export function ModelCardView({ model }: { model: RegimeModelDetail & { card: ModelCard } }) {
  if (model.card.supervised)
    return (
      <SupervisedCardView
        model={model as RegimeModelDetail & { card: ModelCard & { supervised: SupervisedCard } }}
      />
    );
  return <GmmCardView model={model} />;
}

function GmmCardView({ model }: { model: RegimeModelDetail & { card: ModelCard } }) {
  const c = model.card;
  const e = c.evaluation!;
  const d = c.dataset;
  const labels = new Map(c.labels.regimes.map((r) => [String(r.regime_id), r]));
  const params = c.parameters as Record<string, unknown>;
  return (
    <div className="space-y-6">
      <Section
        id="model-overview"
        title={modelName(model)}
        description={`${c.model_type}. Trained ${formatDateTime(c.created_at)} on ${model.instrument.symbol ?? 'a deleted instrument'}.`}
      >
        <dl className="divide-y text-sm">
          <Row label="Model type">{c.model_type}</Row>
          <Row label="Version">{c.model_version}</Row>
          <Row label="Status">
            {model.is_active ? 'Active (used for the current regime)' : 'Not active'}
          </Row>
          <Row label="Training period">{`${day(c.training_start)} to ${day(c.training_end)}`}</Row>
          <Row label="Clusters">
            {`${c.n_components}, chosen from ${c.candidate_components!.join(', ')}. ${c.selection}`}
          </Row>
          <Row label="Seed">{c.random_state}</Row>
          <Row label="Feature windows">
            {`Volatility ${c.feature_parameters!.volatility_window} days, trend ${c.feature_parameters!.trend_window} days`}
          </Row>
          <Row label="Parameters">
            <span className="font-mono text-xs">
              {['covariance_type', 'n_init', 'reg_covar', 'max_iter', 'tol', 'init_params']
                .filter((k) => k in params)
                .map((k) => `${k} = ${String(params[k])}`)
                .join(', ')}
            </span>
          </Row>
          <Row label="scikit-learn">{c.scikit_learn_version}</Row>
        </dl>
      </Section>

      <Section id="model-features" title="Features">
        <table className="w-full text-sm">
          <caption className="sr-only">Model features</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Feature</th>
              <th className="py-2 font-medium">Definition</th>
            </tr>
          </thead>
          <tbody>
            {c.features.map((f) => (
              <tr key={f.name} className="border-b last:border-0">
                <td className="py-1.5 pr-2 font-mono text-xs">{f.name}</td>
                <td className="py-1.5">{f.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        id="model-regimes"
        title="Regimes and how they are named"
        description={c.labels.rule}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Regimes of the model</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Regime</th>
                <th className="py-2 pr-2 font-medium">Volatility</th>
                <th className="py-2 pr-2 font-medium">Trend</th>
                <th className="py-2 pr-2 text-right font-medium">Volatility (a year)</th>
                <th className="py-2 pr-2 text-right font-medium">Mean return (a year)</th>
                <th className="py-2 pr-2 text-right font-medium">Trend strength</th>
                <th className="py-2 text-right font-medium">Training days</th>
              </tr>
            </thead>
            <tbody>
              {c.labels.regimes.map((r) => (
                <tr key={r.code} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1.5">
                      <RegimeChip code={r.code} /> {r.name}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">{r.volatility_state}</td>
                  <td className="py-1.5 pr-2">{r.trend_state}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatPercent(r.annualized_volatility)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatPercent(r.annualized_return)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatNumber(r.mean_trend_strength, 2)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {`${formatNumber(r.training_days, 0)} (${formatPercent(r.training_share)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Values are each cluster&apos;s centre. Volatility and return are annualised with 252 days.
        </p>
      </Section>

      <Section id="model-performance" title="Reported performance" description={c.performance_note}>
        <dl className="divide-y text-sm">
          <Row label="Validation BIC">{formatNumber(e.validation_bic, 1)}</Row>
          <Row label="Test BIC">{formatNumber(e.test_bic, 1)}</Row>
          <Row label="Test days">{formatNumber(e.test_sample_count, 0)}</Row>
          <Row label="Mean highest probability (test)">
            {formatPercent(e.test_mean_max_probability)}
          </Row>
          <Row label="Mean entropy (test)">{formatNumber(e.test_mean_entropy, 3)}</Row>
          <Row label="Test days by regime">
            {Object.entries(e.test_component_counts)
              .map(([id, count]) => [labels.get(id), count] as const)
              .sort(([a], [b]) => (a?.code ?? '').localeCompare(b?.code ?? ''))
              .map(([label, count]) => `${label?.code ?? '?'} ${label?.name ?? ''}: ${count}`)
              .join('; ')}
          </Row>
        </dl>
      </Section>

      <Section
        id="model-dataset"
        title="Dataset"
        description="Daily bars of the reference instrument, split in time order."
      >
        <dl className="divide-y text-sm">
          <Row label="Daily bars">{`${formatNumber(d.bars, 0)}, ${day(d.first_bar)} to ${day(d.last_bar)}`}</Row>
          <Row label="Warm-up rows left out">{`${d.dropped_warm_up_rows} (features need that many earlier days)`}</Row>
          <Row label="Data fingerprint">
            <code className="font-mono text-xs break-all">{d.data_fingerprint ?? MISSING}</code>
          </Row>
          <Row label="Data provider">{d.provider ?? MISSING}</Row>
        </dl>
        <table className="w-full max-w-xl text-sm">
          <caption className="sr-only">Dataset splits</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Split</th>
              <th className="py-2 pr-2 font-medium">Days</th>
              <th className="py-2 font-medium">Dates</th>
            </tr>
          </thead>
          <tbody>
            {d.splits.map((s) => (
              <tr key={s.name} className="border-b last:border-0">
                <td className="py-1.5 pr-2 capitalize">{`${s.name} (${formatPercent(d.ratios[s.name] ?? 0)})`}</td>
                <td className="py-1.5 pr-2 tabular-nums">{formatNumber(s.rows, 0)}</td>
                <td className="py-1.5">{`${day(s.start)} to ${day(s.end)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">
          The scaler is fitted on the training split only; the validation split picks the number of
          clusters; the test split is used once, for the figures above.
        </p>
      </Section>
    </div>
  );
}
