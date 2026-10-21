import { CircleCheck, CircleX } from 'lucide-react';
import { istDate } from '@/features/instruments/market-data';
import { Row, Section } from '@/features/results/parts';
import { formatDate, formatDateTime, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { withAlpha } from '@/features/instruments/chart-colors';
import { ClassChip, RegimeChip } from './RegimeChart';
import {
  classColor,
  classificationText,
  KIND_LABELS,
  modelName,
  type DimensionEvaluation,
  type ModelCard,
  type RegimeModelDetail,
  type SupervisedCard,
} from './regime-model';

const day = (timestamp: string) => formatDate(istDate(timestamp));

const params = (p: Record<string, unknown>) =>
  Object.entries(p)
    .map(([k, v]) => `${k} = ${v === null ? 'None' : String(v)}`)
    .join(', ');

/** Met or not met, exactly as the backend flagged it. */
function TargetBadge({ met }: { met: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        met
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-warning/30 bg-warning/10 text-warning',
      )}
    >
      {met ? (
        <CircleCheck aria-hidden className="size-3.5" />
      ) : (
        <CircleX aria-hidden className="size-3.5" />
      )}
      {met ? 'Meets target' : 'Below target'}
    </span>
  );
}

/** Accuracy as a bar with the target marked on it. */
function AccuracyMeter(props: { accuracy: number; target: number; label: string }) {
  const clamp = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div className="relative h-2 rounded bg-muted" aria-hidden title={props.label}>
      <div className="h-2 rounded bg-primary" style={{ width: clamp(props.accuracy) }} />
      <div
        className="absolute -top-1 h-4 w-0.5 bg-foreground"
        style={{ left: clamp(props.target) }}
      />
    </div>
  );
}

function Summary({ card }: { card: SupervisedCard }) {
  const e = card.evaluation;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {e.dimensions.map((d) => (
          <div
            key={d.key}
            role="group"
            aria-label={`${d.name} accuracy`}
            className="space-y-2 rounded-lg border bg-background p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{d.name}</p>
              <TargetBadge met={d.test.meets_target} />
            </div>
            <p className="text-2xl font-semibold tabular-nums">{formatPercent(d.test.accuracy)}</p>
            <AccuracyMeter
              accuracy={d.test.accuracy}
              target={d.test.target}
              label={`Accuracy ${formatPercent(d.test.accuracy)}, target ${formatPercent(d.test.target)}`}
            />
            <p className="text-xs text-muted-foreground">
              {`Target ${formatPercent(d.test.target)} \u00b7 balanced accuracy ${formatPercent(d.test.balanced_accuracy)} \u00b7 ${d.chosen_kind_name} \u00b7 ${formatNumber(d.test.rows, 0)} test days`}
            </p>
            <p className="text-xs">
              {d.test.beats_baselines
                ? 'Beats both baselines on accuracy.'
                : 'Does not beat both baselines on accuracy.'}
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm">
        {`Mean test accuracy ${formatPercent(e.summary.mean_accuracy)}; ${e.summary.dimensions_meeting_target} of ${e.summary.dimensions} dimensions meet the ${formatPercent(e.target_accuracy)} target.`}
      </p>
    </div>
  );
}

function ConfusionMatrix({ d }: { d: DimensionEvaluation }) {
  const theme = useTheme();
  const m = d.test.confusion_matrix;
  const peak = Math.max(1, ...m.flat());
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <caption className="mb-1 text-left text-xs text-muted-foreground">
          {`${d.name} confusion matrix (test days): rows are the actual class, columns the predicted class.`}
        </caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Actual \ predicted</th>
            {d.classes.map((c) => (
              <th key={c} scope="col" className="px-2 py-1 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.map((row, i) => (
            <tr key={d.classes[i]}>
              <th scope="row" className="px-2 py-1 text-left text-xs font-medium">
                {d.classes[i]}
              </th>
              {row.map((count, j) => (
                <td
                  key={d.classes[j]}
                  className={cn(
                    'min-w-20 border px-2 py-2 text-center tabular-nums',
                    i === j && 'font-semibold',
                  )}
                  style={{
                    background: withAlpha(
                      classColor(theme, i === j ? d.classes[i] : null),
                      Math.round((count / peak) * 160 + 16)
                        .toString(16)
                        .padStart(2, '0'),
                    ),
                  }}
                >
                  {count}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Importance({ d }: { d: DimensionEvaluation }) {
  const top = d.feature_importance;
  const peak = Math.max(...top.map((f) => f.importance), 1e-9);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Feature importance</h4>
      <ul aria-label={`${d.name} feature importance`} className="space-y-1.5">
        {top.map((f) => (
          <li key={f.feature} className="grid grid-cols-[11rem_1fr_3.5rem] items-center gap-2">
            <span className="truncate font-mono text-xs" title={f.feature}>
              {f.feature}
            </span>
            <span className="h-2 rounded bg-muted" aria-hidden>
              <span
                className="block h-2 rounded bg-primary"
                style={{ width: `${(f.importance / peak) * 100}%` }}
              />
            </span>
            <span className="text-right text-xs tabular-nums">{formatPercent(f.importance)}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{d.importance_method}</p>
    </div>
  );
}

function DimensionSection({ d, rule }: { d: DimensionEvaluation; rule: string | undefined }) {
  const t = d.test;
  return (
    <Section
      id={`dimension-${d.key}`}
      title={`${d.name}: ${formatPercent(t.accuracy)} test accuracy`}
      description={rule}
      actions={<TargetBadge met={t.meets_target} />}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <table className="w-full text-sm">
            <caption className="sr-only">{`${d.name}: model and baselines on the test days`}</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">On the test days</th>
                <th className="py-2 pr-2 text-right font-medium">Accuracy</th>
                <th className="py-2 text-right font-medium">Balanced accuracy</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b font-medium">
                <td className="py-1.5 pr-2">{`The model (${d.chosen_kind_name})`}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatPercent(t.accuracy)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatPercent(t.balanced_accuracy)}
                </td>
              </tr>
              {t.baselines.map((b) => (
                <tr key={b.name} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">
                    <p>{`Baseline: ${b.label}`}</p>
                    <p className="text-xs text-muted-foreground">{b.description}</p>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatPercent(b.accuracy)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatPercent(b.balanced_accuracy)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ConfusionMatrix d={d} />
          <table className="w-full text-sm">
            <caption className="sr-only">{`${d.name}: precision and recall by class`}</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Class</th>
                <th className="py-2 pr-2 text-right font-medium">Precision</th>
                <th className="py-2 pr-2 text-right font-medium">Recall</th>
                <th className="py-2 pr-2 text-right font-medium">F1</th>
                <th className="py-2 text-right font-medium">Test days</th>
              </tr>
            </thead>
            <tbody>
              {t.per_class.map((c) => (
                <tr key={c.label} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">
                    <ClassChip label={c.label} />
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatPercent(c.precision)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatPercent(c.recall)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatNumber(c.f1, 2)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatNumber(c.support, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          <Importance d={d} />
          <div className="space-y-2">
            <h4 className="text-sm font-medium">How it was chosen</h4>
            <table className="w-full text-sm">
              <caption className="sr-only">{`${d.name}: candidate models`}</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Candidate</th>
                  <th className="py-2 pr-2 text-right font-medium">CV balanced acc.</th>
                  <th className="py-2 text-right font-medium">Validation balanced acc.</th>
                </tr>
              </thead>
              <tbody>
                {d.candidates.map((c) => (
                  <tr key={c.kind} className="border-b last:border-0 align-top">
                    <td className="py-1.5 pr-2">
                      <p className={cn(c.kind === d.chosen_kind && 'font-medium')}>
                        {c.kind_name}
                        {c.kind === d.chosen_kind ? ' (kept)' : ''}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">{params(c.params)}</p>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {c.cv_balanced_accuracy === null
                        ? MISSING
                        : formatPercent(c.cv_balanced_accuracy)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatPercent(c.validation.balanced_accuracy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Days of each class</h4>
            <table className="w-full text-sm">
              <caption className="sr-only">{`${d.name}: days of each class by split`}</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Class</th>
                  {['train', 'validation', 'test'].map((s) => (
                    <th key={s} className="py-2 pr-2 text-right font-medium capitalize">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.classes.map((c) => (
                  <tr key={c} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{c}</td>
                    {['train', 'validation', 'test'].map((s) => (
                      <td key={s} className="py-1.5 pr-2 text-right tabular-nums">
                        {formatNumber(d.class_counts[s]?.[c] ?? 0, 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Section>
  );
}

/** A supervised model's card: accuracy against the target, baselines and how it was built. */
export function SupervisedCardView({
  model,
}: {
  model: RegimeModelDetail & { card: ModelCard & { supervised: SupervisedCard } };
}) {
  const c = model.card;
  const s = c.supervised;
  const e = s.evaluation;
  const def = s.label_definition;
  const d = c.dataset;
  const rules = new Map(def.rules.map((r) => [r.key, r.rule]));
  return (
    <div className="space-y-6">
      <Section
        id="model-overview"
        title={modelName(model)}
        description={`${c.model_type}. Trained ${formatDateTime(c.created_at)} on ${model.instrument.symbol ?? 'a deleted instrument'}.`}
        actions={
          <span className="inline-flex rounded-md border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
            {classificationText(def.horizon_days)}
          </span>
        }
      >
        <dl className="divide-y text-sm">
          <Row label="Model type">{KIND_LABELS[c.model_kind]}</Row>
          <Row label="Version">{c.model_version}</Row>
          <Row label="Status">
            {model.is_active ? 'Active (used for the current regime)' : 'Not active'}
          </Row>
          <Row label="Label horizon">{`The next ${def.horizon_days} trading days`}</Row>
          <Row label="India VIX">
            {model.vix_instrument
              ? (model.vix_instrument.symbol ?? 'Deleted instrument')
              : 'Not used'}
          </Row>
          <Row label="Training period">{`${day(c.training_start)} to ${day(c.training_end)}`}</Row>
          <Row label="Selection">{c.selection}</Row>
          <Row label="Seed">{c.random_state}</Row>
          <Row label="Libraries">
            {`scikit-learn ${c.scikit_learn_version}${s.xgboost_version ? `, XGBoost ${s.xgboost_version}` : ''}`}
          </Row>
        </dl>
      </Section>

      <Section id="model-accuracy" title="Out-of-sample accuracy" description={c.performance_note}>
        <Summary card={s} />
      </Section>

      {e.dimensions.map((dimension) => (
        <DimensionSection key={dimension.key} d={dimension} rule={rules.get(dimension.key)} />
      ))}

      <Section
        id="model-labels"
        title="What the classes mean"
        description={`Each label describes the next ${def.horizon_days} trading days; the features only use days up to the one being classified.`}
      >
        <dl className="divide-y text-sm">
          {def.rules.map((r) => (
            <Row key={r.key} label={r.name}>
              {r.rule}
            </Row>
          ))}
        </dl>
      </Section>

      <Section id="model-features" title="Features" description={s.volume_note}>
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
        id="model-dataset"
        title="Dataset and splits"
        description="Daily bars of the reference instrument, split in time order with a purge gap between splits."
      >
        <dl className="divide-y text-sm">
          <Row label="Daily bars">{`${formatNumber(d.bars, 0)}, ${day(d.first_bar)} to ${day(d.last_bar)}`}</Row>
          {d.vix_bars !== null && d.vix_bars !== undefined && (
            <Row label="India VIX bars">{formatNumber(d.vix_bars, 0)}</Row>
          )}
          <Row label="Warm-up rows left out">{`${d.dropped_warm_up_rows} (features need up to 252 earlier days)`}</Row>
          <Row label="Unlabelled last days">
            {`${d.unlabelled_rows ?? 0} (their next ${def.horizon_days} days are not known yet)`}
          </Row>
          <Row label="Data fingerprint">
            <code className="font-mono text-xs break-all">{d.data_fingerprint ?? MISSING}</code>
          </Row>
          <Row label="Data provider">{d.provider ?? MISSING}</Row>
        </dl>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Dataset splits and purge gaps</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Split</th>
                <th className="py-2 pr-2 font-medium">Days</th>
                <th className="py-2 pr-2 font-medium">Dates</th>
                <th className="py-2 font-medium">Labels look up to</th>
              </tr>
            </thead>
            <tbody>
              {d.splits.map((split, i) => {
                const gap = d.purges?.[i];
                return [
                  <tr key={split.name} className="border-b">
                    <td className="py-1.5 pr-2 capitalize">{split.name}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{formatNumber(split.rows, 0)}</td>
                    <td className="py-1.5 pr-2">{`${day(split.start)} to ${day(split.end)}`}</td>
                    <td className="py-1.5">
                      {split.label_window_end ? day(split.label_window_end) : MISSING}
                    </td>
                  </tr>,
                  gap ? (
                    <tr key={`gap-${split.name}`} className="border-b text-muted-foreground">
                      <td className="py-1.5 pr-2 text-xs">Purge gap</td>
                      <td className="py-1.5 pr-2 text-xs tabular-nums">
                        {formatNumber(gap.dropped_rows, 0)}
                      </td>
                      <td className="py-1.5 pr-2 text-xs" colSpan={2}>
                        {gap.start && gap.end
                          ? `${day(gap.start)} to ${day(gap.end)}: left out between ${gap.between}, because their labels look ${gap.days} days ahead.`
                          : `No days left out between ${gap.between}.`}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Hyperparameters are chosen by purged walk-forward cross-validation on the training split,
          the model kind on the validation split, and the test split is used once, for the figures
          above. The volatility threshold is the median of the training days.
        </p>
      </Section>

      <Section id="model-regimes" title="Combined regimes" description={c.labels.rule}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Combined regimes of the model</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Regime</th>
                <th className="py-2 pr-2 font-medium">Volatility</th>
                <th className="py-2 pr-2 font-medium">Trend</th>
                <th className="py-2 pr-2 font-medium">Risk</th>
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
                  <td className="py-1.5 pr-2">{r.risk_state ?? MISSING}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {`${formatNumber(r.training_days, 0)} (${formatPercent(r.training_share)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
