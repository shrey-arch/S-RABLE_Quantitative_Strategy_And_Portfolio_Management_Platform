import { CircleCheck, CircleDashed, CircleX, Clock, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { istDate } from '@/features/instruments/market-data';
import {
  reportLink,
  validateLink,
  VALIDATION_STATUS_LABELS,
  VALIDATION_STATUS_TONES,
  type ValidationStatus,
  type ValidationStatusValue,
} from './validation-status';

const TONE_CLASSES = {
  success: 'border-success/30 bg-success/10 text-success',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  info: 'border-info/30 bg-info/10 text-info',
  neutral: 'border-border bg-muted text-muted-foreground',
} as const;

const ICONS: Record<ValidationStatusValue, React.ReactNode> = {
  VALIDATED: <CircleCheck aria-hidden className="size-3.5" />,
  VALIDATED_PAPER_PENDING: <Clock aria-hidden className="size-3.5" />,
  FAILED: <CircleX aria-hidden className="size-3.5" />,
  OUTDATED: <TriangleAlert aria-hidden className="size-3.5" />,
  NOT_VALIDATED: <CircleDashed aria-hidden className="size-3.5" />,
};

/** The status as a small chip; the backend's reason is its tooltip. */
export function ValidationBadge(props: { validation: ValidationStatus; className?: string }) {
  const v = props.validation;
  return (
    <span
      title={v.reason}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[VALIDATION_STATUS_TONES[v.status]],
        props.className,
      )}
    >
      {ICONS[v.status]}
      {VALIDATION_STATUS_LABELS[v.status]}
    </span>
  );
}

/** "Validate it" for a strategy that is not eligible; the report link otherwise. */
export function ValidationLinks(props: {
  validation: ValidationStatus;
  strategyId: string;
  /** False for strategies that cannot be validated (custom Python code). */
  canValidate?: boolean;
}) {
  const v = props.validation;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {!v.eligible && props.canValidate !== false && (
        <Link
          to={validateLink(props.strategyId)}
          className="font-medium text-primary hover:underline"
        >
          Validate it
        </Link>
      )}
      {v.validation_id && (
        <Link to={reportLink(v.validation_id)} className="text-primary hover:underline">
          {v.eligible ? 'Validation report' : 'Latest validation'}
        </Link>
      )}
    </span>
  );
}

/** Badge, the backend's reason and the links: for detail pages and candidate lists. */
export function ValidationSummary(props: {
  validation: ValidationStatus;
  strategyId: string;
  compact?: boolean;
  canValidate?: boolean;
}) {
  const v = props.validation;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <ValidationBadge validation={v} />
        <ValidationLinks
          validation={v}
          strategyId={props.strategyId}
          canValidate={props.canValidate}
        />
      </div>
      <p className={cn('text-muted-foreground', props.compact ? 'text-xs' : 'text-sm')}>
        {v.reason}
        {v.completed_at && !props.compact
          ? ` (validation of version ${v.validated_version ?? '?'}, completed ${formatDate(istDate(v.completed_at))})`
          : ''}
      </p>
    </div>
  );
}
