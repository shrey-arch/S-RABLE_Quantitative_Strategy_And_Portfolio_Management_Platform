import { AlertTriangle, CircleCheck, Info } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatDateTime, formatNumber, MISSING } from '@/lib/format';
import { istDate, providerLabel, qualityWarnings, type Coverage } from './market-data';

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="text-right tabular-nums">{props.children}</dd>
    </div>
  );
}

const count = (n: number) => formatNumber(n, 0);

/** Missing periods shown before "Show all". */
export const PERIODS_SHOWN = 8;

/** What is stored for the selected range, from GET .../market-data/coverage. */
export function CoveragePanel({ coverage }: { coverage: Coverage }) {
  const days = coverage.trading_days;
  const [showAll, setShowAll] = useState(false);
  const periods = showAll ? days.missing_periods : days.missing_periods.slice(0, PERIODS_SHOWN);
  // When checked, the backend only adds a note for years whose holidays it does not know:
  // those holidays are then counted as missing days.
  const holidaysUnknown = days.checked && Boolean(days.note);
  return (
    <Card className="gap-3" aria-labelledby="coverage-title">
      <CardHeader>
        <CardTitle id="coverage-title" className="text-base">
          Data coverage
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <dl className="divide-y">
          <Row label="First bar">
            {coverage.first_timestamp ? formatDate(istDate(coverage.first_timestamp)) : MISSING}
          </Row>
          <Row label="Last bar">
            {coverage.last_timestamp ? formatDate(istDate(coverage.last_timestamp)) : MISSING}
          </Row>
          <Row label="Rows">{count(coverage.row_count)}</Row>
          {days.checked && (
            <>
              <Row label="Trading days in range">{count(days.expected_days)}</Row>
              <Row label="Trading days with data">{count(days.days_with_data)}</Row>
              <Row label="Trading days missing">
                <span className={days.missing_days > 0 ? 'font-medium text-warning' : undefined}>
                  {count(days.missing_days)}
                </span>
                {holidaysUnknown && days.missing_days > 0 && (
                  <span className="block text-xs text-muted-foreground">may include holidays</span>
                )}
              </Row>
            </>
          )}
          <Row label="Provider">{providerLabel(coverage.provider)}</Row>
          <Row label="Last import">
            {coverage.last_imported_at ? formatDateTime(coverage.last_imported_at) : MISSING}
          </Row>
        </dl>

        {days.note && (
          <p className="mt-3 flex gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-px size-3.5 shrink-0" />
            {days.note}
          </p>
        )}

        {days.missing_periods.length > 0 && (
          <div className="mt-3 space-y-1">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Missing periods
            </h4>
            <ul className="space-y-0.5">
              {periods.map((p) => (
                <li key={p.start} className="tabular-nums">
                  {p.start === p.end
                    ? formatDate(p.start)
                    : `${formatDate(p.start)} to ${formatDate(p.end)}`}{' '}
                  <span className="text-muted-foreground">
                    ({p.days} {p.days === 1 ? 'trading day' : 'trading days'})
                  </span>
                </li>
              ))}
            </ul>
            {days.missing_periods.length > PERIODS_SHOWN && (
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? 'Show fewer' : `Show all ${days.missing_periods.length} listed periods`}
              </Button>
            )}
            {showAll && days.missing_periods_truncated && (
              <p className="text-xs text-muted-foreground">
                The backend lists only the first {days.missing_periods.length} periods.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The backend's data-quality checks, shown as warnings. */
export function QualityPanel({ coverage }: { coverage: Coverage }) {
  const warnings = qualityWarnings(coverage);
  return (
    <Card className="gap-3" aria-labelledby="quality-title">
      <CardHeader>
        <CardTitle id="quality-title" className="text-base">
          Data quality
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {coverage.row_count === 0 ? (
          <p className="text-muted-foreground">No data to check in this range.</p>
        ) : warnings.length === 0 ? (
          <p className="flex items-center gap-2 text-success">
            <CircleCheck aria-hidden className="size-4" />
            No problems found by the backend checks.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Data quality warnings">
            {warnings.map((w) => (
              <li
                key={w}
                className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-2"
              >
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Checks: missing values, duplicate timestamps, prices at or below zero, zero or negative
          volume, and data on days the exchange was closed.
        </p>
      </CardContent>
    </Card>
  );
}
