import { AlertTriangle, CircleCheck, Download } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangeField, rangeError, type DateRangeValue } from '@/components/ui/date-range-field';
import { Spinner } from '@/components/ui/spinner';
import { formatDate } from '@/lib/format';
import { canImport, useImportMarketData, todayIst, type ImportResult } from './market-data';
import type { Instrument } from './queries';

function oneYearBefore(day: string) {
  const [y, m, d] = day.split('-');
  return `${Number(y) - 1}-${m}-${d}`;
}

function Result({ result }: { result: ImportResult }) {
  const reasons = Object.entries(result.rejected_reasons);
  const nothing = result.fetched === 0;
  return (
    <div
      role="status"
      className={
        nothing
          ? 'flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm'
          : 'flex gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm'
      }
    >
      {nothing ? (
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      ) : (
        <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
      )}
      <div className="space-y-1">
        <p>
          {formatDate(result.start_date)} to {formatDate(result.end_date)}: fetched {result.fetched}
          , stored {result.inserted}, already stored {result.skipped_existing}, rejected{' '}
          {result.rejected}.
        </p>
        {reasons.length > 0 && (
          <p className="text-muted-foreground">
            Rejected: {reasons.map(([why, n]) => `${why} (${n})`).join('; ')}.
          </p>
        )}
        {nothing && (
          <p className="text-muted-foreground">
            The provider returned no bars. Check the symbol (Yahoo looks up SYMBOL.NS), the dates
            and the backend computer&apos;s internet connection.
          </p>
        )}
      </div>
    </div>
  );
}

/** Imports daily bars from the provider for a date range (POST .../market-data/import). */
export function ImportDataCard(props: { instrument: Instrument; lastStoredDay?: string }) {
  const today = todayIst();
  const [range, setRange] = useState<DateRangeValue>({
    start: props.lastStoredDay ?? oneYearBefore(today),
    end: today,
  });
  const run = useImportMarketData(props.instrument.id);
  const supported = canImport(props.instrument);
  const invalid = !range.start || !range.end || rangeError(range, today) !== null;

  return (
    <Card className="gap-4" aria-labelledby="import-title">
      <CardHeader>
        <CardTitle id="import-title" className="text-base">
          Import historical data
        </CardTitle>
        <CardDescription>
          Downloads daily bars from Yahoo Finance and stores the ones not stored yet. Historical
          data only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported ? (
          <p className="text-sm text-muted-foreground">
            Import supports NSE equities, ETFs and indices only. This instrument is{' '}
            {props.instrument.exchange} / {props.instrument.instrument_type}.
          </p>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid) run.mutate({ start: range.start, end: range.end });
            }}
          >
            <DateRangeField
              value={range}
              onChange={setRange}
              max={today}
              labels={{ start: 'Import from', end: 'Import to' }}
            />
            <Button type="submit" disabled={invalid || run.isPending}>
              {run.isPending ? <Spinner /> : <Download />}
              {run.isPending ? 'Importing...' : 'Import'}
            </Button>
          </form>
        )}
        {run.isError && (
          <p role="alert" className="text-sm text-destructive">
            {run.error instanceof ApiError && run.error.status === 502
              ? "The price provider could not be reached from the backend. Check the backend computer's internet connection and try again."
              : run.error.message}
          </p>
        )}
        {run.isSuccess && <Result result={run.data} />}
      </CardContent>
    </Card>
  );
}
