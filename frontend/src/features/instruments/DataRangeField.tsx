import { AlertTriangle, CircleCheck } from 'lucide-react';
import { useEffect } from 'react';
import { DateRangeField, type DateRangeValue } from '@/components/ui/date-range-field';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { storedSpan, useDataRangeStatus, type DataRangeStatus } from './data-range';
import { todayIst, useCoverage } from './market-data';

/**
 * A date range for one instrument that only accepts ranges with stored daily data.
 * A range is accepted when stored bars fall inside it; the backend's coverage says
 * how many bars it holds and whether trading days are missing. Forms read the result
 * through `onStatusChange` and block submitting unless the kind is "ok".
 */
export function DataRangeField(props: {
  instrumentId: string;
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  onStatusChange?: (status: DataRangeStatus) => void;
  className?: string;
}) {
  const status = useDataRangeStatus(props.instrumentId, props.value);
  const span = storedSpan(useCoverage(props.instrumentId, {}).data);
  const { onStatusChange } = props;

  useEffect(() => {
    onStatusChange?.(status);
    // The status object is rebuilt each render; report when what it says changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind, 'message' in status ? status.message : '', onStatusChange]);

  const error = status.kind === 'invalid' || status.kind === 'no-data' ? status.message : null;

  return (
    <div className={cn('space-y-2', props.className)}>
      <DateRangeField
        value={props.value}
        onChange={props.onChange}
        max={todayIst()}
        error={error}
      />
      <div aria-live="polite" className="space-y-1 text-xs">
        {span && (
          <p className="text-muted-foreground">
            Stored daily data: {formatDate(span.first)} to {formatDate(span.last)}.
          </p>
        )}
        {status.kind === 'no-instrument' && (
          <p className="text-muted-foreground">Choose an instrument first.</p>
        )}
        {status.kind === 'loading' && (
          <p className="text-muted-foreground">Checking stored data...</p>
        )}
        {status.kind === 'error' && (
          <p className="text-destructive">Could not check the stored data. Try again.</p>
        )}
        {status.kind === 'incomplete' && <p className="text-muted-foreground">{status.message}</p>}
        {status.kind === 'ok' && (
          <>
            <p className="flex items-center gap-1.5 text-success">
              <CircleCheck aria-hidden className="size-3.5" />
              {status.message}
            </p>
            {status.warning && (
              <p className="flex items-center gap-1.5 text-warning">
                <AlertTriangle aria-hidden className="size-3.5" />
                {status.warning}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
