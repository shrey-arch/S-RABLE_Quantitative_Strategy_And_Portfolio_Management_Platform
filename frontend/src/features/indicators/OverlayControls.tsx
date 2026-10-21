import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { OVERLAY_COLORS } from '@/features/instruments/chart-colors';
import { useTheme } from '@/lib/theme';
import { IndicatorForm } from './IndicatorForm';
import { MAX_OVERLAYS, overlayLabel, type OverlaySpec } from './overlays';
import type { IndicatorInfo } from './queries';

export interface OverlayStatus {
  loading: boolean;
  error?: string;
}

/**
 * Indicators drawn on the instrument chart: one chip per indicator (with its colour
 * and a remove button) and an "Add indicator" form. Values come from the backend.
 */
export function OverlayControls(props: {
  catalogue: IndicatorInfo[];
  overlays: OverlaySpec[];
  status: OverlayStatus[];
  onAdd: (overlay: OverlaySpec) => void;
  onRemove: (index: number) => void;
}) {
  const theme = useTheme();
  const [adding, setAdding] = useState(false);
  const full = props.overlays.length >= MAX_OVERLAYS;
  const colors = OVERLAY_COLORS[theme];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Chart indicators">
        <span className="text-sm text-muted-foreground">Indicators:</span>
        {props.overlays.length === 0 && <span className="text-sm text-muted-foreground">none</span>}
        {props.overlays.map((o, i) => {
          const label = overlayLabel(o);
          const status = props.status[i];
          return (
            <span
              key={`${label}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-2.5 text-xs"
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ backgroundColor: colors[i % colors.length] }}
              />
              <span className="font-mono">{label}</span>
              {status?.loading && <Spinner className="size-3" />}
              <Button
                variant="ghost"
                size="icon"
                className="size-5 rounded-full"
                aria-label={`Remove ${label}`}
                onClick={() => props.onRemove(i)}
              >
                <X className="size-3" />
              </Button>
            </span>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          disabled={full}
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
        >
          <Plus /> Add indicator
        </Button>
        {full && (
          <span className="text-xs text-muted-foreground">Up to {MAX_OVERLAYS} at a time.</span>
        )}
      </div>

      {props.status.map((s, i) =>
        s.error ? (
          <p key={i} role="alert" className="text-xs text-destructive">
            {overlayLabel(props.overlays[i]!)}: {s.error}
          </p>
        ) : null,
      )}

      {adding && !full && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <IndicatorForm
            catalogue={props.catalogue}
            showName={false}
            submitLabel="Add to chart"
            onSave={(value) => {
              props.onAdd({ key: value.type, parameters: value.parameters });
              setAdding(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
