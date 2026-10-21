import { OVERLAY_COLORS } from '@/features/instruments/chart-colors';
import { toNumber } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { weightText } from './portfolio-model';

const R = 54;
const C = 2 * Math.PI * R;
const CASH = { light: '#94a3b8', dark: '#64748b' } as const;

export interface Slice {
  label: string;
  /** The API's weight (a fraction as a decimal string), drawn as given. */
  weight: string;
  cash?: boolean;
}

/**
 * Allocation weights as a donut. Each slice is the API's weight for one asset,
 * plus cash; the legend names every slice with its weight (colour is never the
 * only cue).
 */
export function AllocationDonut(props: { slices: Slice[]; label: string }) {
  const theme = useTheme();
  const palette = OVERLAY_COLORS[theme];
  let offset = 0;
  const colorOf = (i: number, s: Slice) => (s.cash ? CASH[theme] : palette[i % palette.length]);
  return (
    <figure className="flex flex-wrap items-center gap-6">
      <svg role="img" aria-label={props.label} viewBox="0 0 140 140" className="size-36 shrink-0">
        <circle cx="70" cy="70" r={R} fill="none" className="stroke-muted" strokeWidth="18" />
        {props.slices.map((s, i) => {
          const share = Math.max(0, toNumber(s.weight) ?? 0);
          const dash = share * C;
          const el = (
            <circle
              key={s.label}
              data-slice={s.label}
              data-weight={s.weight}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={colorOf(i, s)}
              strokeWidth="18"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            >
              <title>{`${s.label}: ${weightText(s.weight)}`}</title>
            </circle>
          );
          offset += dash;
          return el;
        })}
      </svg>
      <figcaption>
        <ul className="space-y-1.5 text-sm">
          {props.slices.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 rounded-sm"
                style={{ background: colorOf(i, s) }}
              />
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums text-muted-foreground">{weightText(s.weight)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
