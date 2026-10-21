import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { decodeOverlay, encodeOverlay, type OverlaySpec } from './overlays';
import { useIndicators } from './queries';

/** Chart indicators live in the address too (?ind=SMA:window=20), so a reload keeps them. */
export function useOverlaySpecs() {
  const [params, setParams] = useSearchParams();
  const catalogue = useIndicators();
  const encoded = params.getAll('ind');
  const specs = useMemo(
    () =>
      encoded
        .map((text) => decodeOverlay(text, catalogue.data ?? []))
        .filter((o): o is OverlaySpec => o !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [encoded.join('|'), catalogue.data],
  );
  const write = (next: OverlaySpec[]) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('ind');
        for (const o of next) p.append('ind', encodeOverlay(o));
        return p;
      },
      { replace: true },
    );
  return {
    catalogue,
    specs,
    add: (o: OverlaySpec) => write([...specs, o]),
    remove: (index: number) => write(specs.filter((_, i) => i !== index)),
  };
}
