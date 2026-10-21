import { useId } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Label } from './label';

export interface DateRangeValue {
  start: string;
  end: string;
}

/** "YYYY-MM-DD" strings compare correctly as text. */
export function rangeError(value: DateRangeValue, max?: string): string | null {
  if (value.start && value.end && value.end < value.start)
    return 'The end date is before the start date.';
  if (max && value.end && value.end > max) return 'The end date cannot be in the future.';
  return null;
}

/**
 * Two native date inputs ("From" and "To") with a shared error line.
 * Values are "YYYY-MM-DD" strings ("" = open end).
 */
export function DateRangeField(props: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  min?: string;
  max?: string;
  error?: string | null;
  className?: string;
  labels?: { start: string; end: string };
}) {
  const id = useId();
  const error = props.error ?? rangeError(props.value, props.max);
  const errorId = error ? `${id}-error` : undefined;
  const labels = props.labels ?? { start: 'From', end: 'To' };

  return (
    <div className={cn('space-y-1', props.className)}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-start`}>{labels.start}</Label>
          <Input
            id={`${id}-start`}
            type="date"
            className="w-40"
            value={props.value.start}
            min={props.min}
            max={props.value.end || props.max}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            onChange={(e) => props.onChange({ ...props.value, start: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-end`}>{labels.end}</Label>
          <Input
            id={`${id}-end`}
            type="date"
            className="w-40"
            value={props.value.end}
            min={props.value.start || props.min}
            max={props.max}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            onChange={(e) => props.onChange({ ...props.value, end: e.target.value })}
          />
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
