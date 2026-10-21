import {
  formatDate,
  formatDateTime,
  formatINR,
  formatNumber,
  formatPercent,
  MISSING,
  toNumber,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * Number and date display components.
 * Missing values show an em dash (never 0). Pass `missingReason` to explain why on hover.
 */

type NumberLike = number | string | null | undefined;

/** An em dash; with a reason, hovering or focusing it explains why the value is missing. */
export function Missing({ reason }: { reason?: string }) {
  if (!reason) return <span className="text-muted-foreground">{MISSING}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`Not available: ${reason}`}
          className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2"
        >
          {MISSING}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function signClass(n: number, colored?: boolean) {
  if (!colored) return '';
  return n > 0 ? 'text-success' : n < 0 ? 'text-destructive' : '';
}

export function MoneyText(props: {
  value: NumberLike;
  colored?: boolean;
  missingReason?: string;
  className?: string;
}) {
  const n = toNumber(props.value);
  if (n === null) return <Missing reason={props.missingReason} />;
  return (
    <span className={cn('tabular-nums', signClass(n, props.colored), props.className)}>
      {formatINR(n)}
    </span>
  );
}

export function PercentText(props: {
  value: NumberLike;
  input?: 'fraction' | 'percent';
  colored?: boolean;
  missingReason?: string;
  className?: string;
}) {
  const n = toNumber(props.value);
  if (n === null) return <Missing reason={props.missingReason} />;
  return (
    <span className={cn('tabular-nums', signClass(n, props.colored), props.className)}>
      {formatPercent(n, props.input)}
    </span>
  );
}

/** A plain number (ratios, counts) to `decimals` places. */
export function NumberText(props: {
  value: NumberLike;
  decimals?: number;
  colored?: boolean;
  missingReason?: string;
  className?: string;
}) {
  const n = toNumber(props.value);
  if (n === null) return <Missing reason={props.missingReason} />;
  return (
    <span className={cn('tabular-nums', signClass(n, props.colored), props.className)}>
      {formatNumber(n, props.decimals ?? 2)}
    </span>
  );
}

export function DateText(props: {
  value: string | null | undefined;
  withTime?: boolean;
  className?: string;
}) {
  if (!props.value) return <Missing />;
  return (
    <time dateTime={props.value} className={cn('tabular-nums', props.className)}>
      {props.withTime ? formatDateTime(props.value) : formatDate(props.value)}
    </time>
  );
}
