import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { istDate } from '@/features/instruments/market-data';
import { classColor, codeColor } from '@/features/regime/regime-model';
import { Row, Section } from '@/features/results/parts';
import { toChartPoints } from '@/features/results/results-model';
import { formatDate, formatNumber, formatPercent } from '@/lib/format';
import { RegimeCards } from './RegimeCards';
import { GroupedBarChart, RegimeEquityChart } from './ValidationCharts';
import { percentOrMissing, type RegimeRow, type ValidationReport } from './validation-model';

const day = (t: string) => formatDate(istDate(t));
const UNCLASSIFIED = 'unclassified';

function judgedText(row: RegimeRow, minDays: number) {
  if (row.judged === null || row.judged === undefined) return 'Shown only (judged by dimension)';
  if (row.days === 0) return 'Not observed';
  return row.judged ? 'Judged' : `Insufficient data (under ${minDays} days)`;
}

function RegimeTable(props: {
  rows: RegimeRow[];
  caption: string;
  minDays: number;
  code: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[50rem] text-sm">
        <caption className="sr-only">{props.caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-2 font-medium">Regime</th>
            <th className="py-2 pr-2 text-right font-medium">Days</th>
            <th className="py-2 pr-2 text-right font-medium">Share</th>
            <th className="py-2 pr-2 text-right font-medium">Return</th>
            <th className="py-2 pr-2 text-right font-medium">Mean return (a year)</th>
            <th className="py-2 pr-2 text-right font-medium">Volatility</th>
            <th className="py-2 pr-2 text-right font-medium">Max drawdown</th>
            <th className="py-2 pr-2 text-right font-medium">Fills</th>
            <th className="py-2 font-medium">Judged</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="py-1.5 pr-2 font-medium">
                {props.code && r.code ? (
                  <span className="mr-1.5 font-mono text-xs text-muted-foreground">{r.code}</span>
                ) : null}
                {r.name}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{formatNumber(r.days, 0)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{formatPercent(r.share)}</td>
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
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {formatNumber(r.trade_count, 0)}
              </td>
              <td className="py-1.5 text-xs">{judgedText(r, props.minDays)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bars(props: { rows: RegimeRow[]; label: string; byCode?: boolean }) {
  const observed = props.rows.filter((r) => r.days > 0);
  if (observed.length === 0) return null;
  return (
    <GroupedBarChart
      label={props.label}
      // Combined regimes are labelled by code (the table above names each one).
      categories={observed.map((r) => (props.byCode && r.code ? r.code : r.name))}
      series={[
        { name: 'Return', values: observed.map((r) => r.total_return) },
        {
          name: 'Max drawdown',
          values: observed.map((r) => (r.max_drawdown === null ? null : -r.max_drawdown)),
        },
      ]}
      format={(v) => formatPercent(v)}
    />
  );
}

/** Stage 3 when the regimes come from the market regime model (Feature 3). */
export function ModelRegimeStage({ report }: { report: ValidationReport }) {
  const stage = report.stages.regime_stress;
  const method = stage.method!;
  const model = method.model!;
  const minDays = method.min_days ?? 20;
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
  const dimensions = stage.dimensions ?? [];
  const [shade, setShade] = useState<string>('combined');
  const shading = dimensions.find((d) => d.key === shade);
  const periods = shading ? shading.periods : stage.periods;
  const names = shading
    ? Object.fromEntries(shading.rows.map((r) => [r.key, r.name]))
    : Object.fromEntries(stage.regimes.map((r) => [r.key, `${r.code ?? ''} ${r.name}`.trim()]));
  const keys = shading ? shading.rows.map((r) => r.key) : stage.regimes.map((r) => r.key);
  const colorOf = useMemo(
    () =>
      shading
        ? (key: string, theme: Parameters<typeof classColor>[0]) =>
            key === UNCLASSIFIED ? undefined : classColor(theme, key)
        : (key: string, theme: Parameters<typeof codeColor>[0]) =>
            key === UNCLASSIFIED ? undefined : codeColor(theme, key),
    [shading],
  );
  const unclassified = stage.unclassified;
  const inSample = stage.in_sample;

  return (
    <>
      <Section id="regime-method" title="How the regimes were found">
        <p className="text-sm">{method.method}</p>
        <dl className="divide-y text-sm">
          <Row label="Regime model">
            <Link
              to={`/app/regime?tab=model&model=${model.id}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {`${model.name} (${model.version})`}
            </Link>
            {` \u00b7 ${model.kind_name}`}
            {model.horizon_days ? ` \u00b7 next ${model.horizon_days} days` : ''}
          </Row>
          <Row label="Reference instrument">{model.instrument_symbol ?? 'Deleted instrument'}</Row>
          <Row label="Trained on">
            {model.training_start && model.training_end
              ? `${day(model.training_start)} to ${day(model.in_sample_end ?? model.training_end)}`
              : 'Not recorded'}
          </Row>
          <Row label="Classified days">{formatNumber(stage.labelled_days, 0)}</Row>
        </dl>
        {inSample?.flag && (
          <p
            role="note"
            className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {inSample.flag}
          </p>
        )}
      </Section>

      <Section
        id="regime-table"
        title="Performance by regime"
        description={`${dimensions.length ? 'Combined regimes (all three dimensions). ' : ''}A regime with fewer than ${minDays} days is not judged.`}
      >
        <RegimeCards rows={stage.regimes} code />
        <RegimeTable rows={stage.regimes} caption="Performance by regime" minDays={minDays} code />
        <Bars rows={stage.regimes} label="Return and maximum drawdown by regime" byCode />
      </Section>

      {dimensions.map((d) => (
        <Section
          key={d.key}
          id={`regime-dimension-${d.key}`}
          title={`Performance by ${d.name.toLowerCase()}`}
          description="Each class of this dimension is judged on its own (at least the minimum days)."
        >
          <RegimeCards rows={d.rows} />
          <RegimeTable
            rows={d.rows}
            caption={`Performance by ${d.name.toLowerCase()}`}
            minDays={minDays}
            code={false}
          />
          <Bars rows={d.rows} label={`Return and maximum drawdown by ${d.name.toLowerCase()}`} />
        </Section>
      ))}

      <Section
        id="regime-unjudged"
        title="Unclassified and insufficient"
        description="Days the model gave no regime, and regimes with too few days to judge."
      >
        {unclassified && unclassified.days > 0 ? (
          <div className="space-y-2">
            <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Unclassified days">
              {unclassified.reasons.map((r) => (
                <li key={r.reason}>{`${formatNumber(r.days, 0)} days: ${r.description}`}</li>
              ))}
            </ul>
            <ul
              className="space-y-0.5 text-xs text-muted-foreground"
              aria-label="Unclassified periods"
            >
              {unclassified.periods.map((p) => (
                <li
                  key={p.start}
                >{`${day(p.start)} to ${day(p.end)} (${p.bars} ${p.bars === 1 ? 'day' : 'days'})`}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Every day of the backtest was classified.</p>
        )}
        {stage.insufficient && stage.insufficient.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Insufficient regimes">
            {stage.insufficient.map((r) => (
              <li key={r.key}>
                {`${r.name}: ${formatNumber(r.days, 0)} ${r.days === 1 ? 'day' : 'days'} (under ${minDays}), not judged.`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No observed regime has fewer than {minDays} days.
          </p>
        )}
      </Section>

      <Section
        id="regime-equity"
        title="Equity curve by regime"
        description="The validation backtest's equity; each day is shaded by the model's regime (unclassified days are not shaded)."
        actions={
          dimensions.length ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Shade by</span>
              <NativeSelect value={shade} onChange={(e) => setShade(e.target.value)}>
                <NativeSelectOption value="combined">Combined regime</NativeSelectOption>
                {dimensions.map((d) => (
                  <NativeSelectOption key={d.key} value={d.key}>
                    {d.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : undefined
        }
      >
        <RegimeEquityChart
          equity={equity}
          periods={periods}
          names={names}
          keys={keys}
          colorOf={colorOf}
          label={`Equity curve with ${periods.length} regime periods shaded`}
        />
      </Section>
    </>
  );
}
