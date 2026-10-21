import { cn } from '@/lib/utils';
import { humanize } from '@/lib/format';

/**
 * Status badge for backend enum values.
 * The text label always carries the meaning; colour only supports it.
 * Unknown values still render (neutral) so a new backend state never breaks the page.
 */

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type StatusKind =
  | 'execution'
  | 'connection'
  | 'account'
  | 'active'
  | 'notificationType'
  | 'priority'
  | 'paperOrder'
  | 'paperDeployment'
  | 'liveSession';

const TONES: Record<StatusKind, Record<string, Tone>> = {
  execution: {
    PENDING: 'neutral',
    RUNNING: 'info',
    COMPLETED: 'success',
    FAILED: 'danger',
    CANCELLED: 'warning',
  },
  connection: { CONNECTED: 'success', DISCONNECTED: 'neutral', EXPIRED: 'warning' },
  account: { ACTIVE: 'success', INACTIVE: 'neutral', SUSPENDED: 'danger' },
  active: { true: 'success', false: 'neutral' },
  notificationType: { INFO: 'info', WARNING: 'warning', ERROR: 'danger', TRADE: 'neutral' },
  priority: { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger' },
  paperOrder: {
    OPEN: 'info',
    TRIGGER_PENDING: 'warning',
    FILLED: 'success',
    CANCELLED: 'neutral',
    REJECTED: 'danger',
    EXPIRED: 'neutral',
  },
  paperDeployment: {
    ACTIVE: 'success',
    PAUSED: 'warning',
    STOPPED: 'neutral',
    COMPLETED: 'info',
    FAILED: 'danger',
  },
  liveSession: {
    PENDING: 'neutral',
    RUNNING: 'success',
    STALE: 'warning',
    PAUSED: 'warning',
    STOPPED: 'neutral',
    COMPLETED: 'info',
    FAILED: 'danger',
  },
};

const LABELS: Partial<Record<StatusKind, Record<string, string>>> = {
  active: { true: 'Active', false: 'Inactive' },
  liveSession: {
    PENDING: 'Starting',
    RUNNING: 'Running',
    STALE: 'Data stale',
    PAUSED: 'Paused',
    STOPPED: 'Stopped',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
  },
};

/** Phase 16: a broker connection status is shown exactly as the backend returns it. */
const VERBATIM: StatusKind[] = ['connection'];

const TONE_CLASSES: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-info/30 bg-info/10 text-info',
  neutral: 'border-border bg-muted text-muted-foreground',
};

const DOT_CLASSES: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  neutral: 'bg-muted-foreground',
};

export function resolveStatus(kind: StatusKind, value: string | boolean | null | undefined) {
  if (value === null || value === undefined) return { tone: 'neutral' as Tone, label: '\u2014' };
  const key = String(value);
  return {
    tone: TONES[kind][key] ?? ('neutral' as Tone),
    label: LABELS[kind]?.[key] ?? (VERBATIM.includes(kind) ? key : humanize(key)),
  };
}

export function StatusBadge(props: {
  kind: StatusKind;
  value: string | boolean | null | undefined;
  className?: string;
}) {
  const { tone, label } = resolveStatus(props.kind, props.value);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        props.className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          DOT_CLASSES[tone],
          label === 'Running' && 'animate-pulse',
        )}
      />
      {label}
    </span>
  );
}
