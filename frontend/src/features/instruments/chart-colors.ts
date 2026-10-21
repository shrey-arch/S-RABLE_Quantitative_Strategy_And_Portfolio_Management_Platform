import type { ChartOptions, DeepPartial } from 'lightweight-charts';
import type { Theme } from '@/lib/theme';

/** Theme colours as hex (the chart library cannot read the app's oklch tokens). */
export const CHART_PALETTE: Record<
  Theme,
  { up: string; down: string; text: string; grid: string }
> = {
  light: { up: '#298646', down: '#c92f33', text: '#5c646f', grid: '#dde2e6' },
  dark: { up: '#5bbd74', down: '#f66d67', text: '#989fa8', grid: '#292e35' },
};

/** Indicator overlay colours, distinct from the green/red of the candles. */
export const OVERLAY_COLORS: Record<Theme, string[]> = {
  light: ['#2563eb', '#d97706', '#7c3aed', '#0891b2'],
  dark: ['#60a5fa', '#fbbf24', '#a78bfa', '#22d3ee'],
};

/** Height of one separate indicator pane, added below price and volume. */
export const PANE_HEIGHT = 120;

export const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`;

/** Layout shared by every chart in the app: transparent background, theme text and grid. */
export function chartOptions(theme: Theme): DeepPartial<ChartOptions> {
  const colors = CHART_PALETTE[theme];
  return {
    autoSize: true,
    layout: {
      background: { color: 'transparent' },
      textColor: colors.text,
      attributionLogo: true,
      panes: { separatorColor: colors.grid, separatorHoverColor: withAlpha(colors.grid, '80') },
    },
    grid: {
      vertLines: { color: withAlpha(colors.grid, '80') },
      horzLines: { color: withAlpha(colors.grid, '80') },
    },
    rightPriceScale: { borderColor: colors.grid },
    // fitContent() shows every bar, even years of daily bars on a phone.
    timeScale: { borderColor: colors.grid, minBarSpacing: 0.001 },
    localization: { locale: 'en-IN' },
  };
}
