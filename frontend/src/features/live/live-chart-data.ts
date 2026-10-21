import type { UTCTimestamp } from 'lightweight-charts';
import { chartTime, type FormingBar, type LiveBar } from './live-model';

export interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

const toCandle = (b: LiveBar): Candle => ({
  time: chartTime(b.time) as UTCTimestamp,
  open: b.open,
  high: b.high,
  low: b.low,
  close: b.close,
});

/** The closed bars, then the forming one (drawn the same way, it is the newest). */
export function candlesOf(bars: LiveBar[], forming: FormingBar | null): Candle[] {
  // One candle per start time, oldest first (the chart requires it).
  const out: Candle[] = [];
  for (const c of bars.map(toCandle).sort((a, b) => a.time - b.time)) {
    if (out.length && out[out.length - 1]!.time === c.time) out[out.length - 1] = c;
    else out.push(c);
  }
  if (forming) {
    const f = toCandle(forming);
    const last = out.at(-1);
    if (!last || f.time > last.time) out.push(f);
  }
  return out;
}

/**
 * What to send to the chart: `null` means draw everything again (setData);
 * otherwise only the candles that changed at the end (series.update()), as when
 * the forming bar moves or a bar closes and the next one starts.
 */
export function tailUpdates(prev: Candle[], next: Candle[]): Candle[] | null {
  if (!prev.length || next.length < prev.length || next.length > prev.length + 1) return null;
  for (let i = 0; i < prev.length - 1; i += 1) {
    const a = prev[i]!;
    const b = next[i]!;
    if (a.time !== b.time || a.close !== b.close || a.high !== b.high || a.low !== b.low)
      return null;
  }
  const changed: Candle[] = [];
  const at = prev.length - 1;
  const a = prev[at]!;
  const b = next[at]!;
  if (a.time !== b.time) return null;
  if (a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close)
    changed.push(b);
  if (next.length > prev.length) changed.push(next.at(-1)!);
  return changed;
}
