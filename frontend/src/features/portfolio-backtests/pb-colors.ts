import type { Theme } from '@/lib/theme';

/** Line colours: portfolio, Nifty 50, equal weight, 60/40. */
export const LINE_COLORS: Record<Theme, string[]> = {
  light: ['#2563eb', '#d97706', '#7c3aed', '#0891b2'],
  dark: ['#60a5fa', '#fbbf24', '#a78bfa', '#22d3ee'],
};

/** Strategy colours in the weights chart (repeating after ten); cash is grey. */
export const SLEEVE_COLORS: Record<Theme, string[]> = {
  light: [
    '#2563eb',
    '#16a34a',
    '#d97706',
    '#7c3aed',
    '#db2777',
    '#0891b2',
    '#65a30d',
    '#ea580c',
    '#4f46e5',
    '#0d9488',
  ],
  dark: [
    '#60a5fa',
    '#4ade80',
    '#fbbf24',
    '#a78bfa',
    '#f472b6',
    '#22d3ee',
    '#a3e635',
    '#fb923c',
    '#818cf8',
    '#2dd4bf',
  ],
};
export const CASH_COLOR: Record<Theme, string> = { light: '#9ca3af', dark: '#6b7280' };

export const sleeveColor = (index: number, theme: Theme) =>
  SLEEVE_COLORS[theme][index % SLEEVE_COLORS[theme].length]!;
