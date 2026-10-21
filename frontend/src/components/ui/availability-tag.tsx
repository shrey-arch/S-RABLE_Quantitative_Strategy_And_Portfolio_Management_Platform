import { cn } from '@/lib/utils';

export type Availability = 'available' | 'planned';

/** "Available" / "Planned" tag. Planned = deferred by Phase 0: shown for context, never usable. */
export function AvailabilityTag(props: { value: Availability; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        props.value === 'available'
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-border bg-muted text-muted-foreground',
        props.className,
      )}
    >
      {props.value === 'available' ? 'Available' : 'Planned'}
    </span>
  );
}
