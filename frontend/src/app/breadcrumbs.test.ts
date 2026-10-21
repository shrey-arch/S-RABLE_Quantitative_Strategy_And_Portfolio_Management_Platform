import { describe, expect, it } from 'vitest';
import { getCrumbs, pageTitle } from './breadcrumbs';

describe('breadcrumbs', () => {
  it('section pages show group and section', () => {
    expect(getCrumbs('/app/dashboard')).toEqual([{ label: 'Workspace' }, { label: 'Dashboard' }]);
    expect(getCrumbs('/app/builder/new')).toEqual([
      { label: 'Research' },
      { label: 'Strategy Builder' },
    ]);
  });

  it('detail pages link back to their list', () => {
    expect(getCrumbs('/app/strategies/123')).toEqual([
      { label: 'Research' },
      { label: 'Strategies', to: '/app/strategies' },
      { label: 'Strategy' },
    ]);
  });

  it('never links to a "new" page as a parent', () => {
    expect(getCrumbs('/app/backtests/abc')).toEqual([
      { label: 'Backtesting' },
      { label: 'Backtest' },
    ]);
  });

  it('not-available and unknown pages show just their title', () => {
    expect(getCrumbs('/app/notifications')).toEqual([
      { label: 'Account' },
      { label: 'Notifications' },
    ]);
    expect(getCrumbs('/app/records')).toEqual([
      { label: 'Backtesting' },
      { label: 'Trading Records' },
    ]);
    expect(getCrumbs('/app/scoring')).toEqual([{ label: 'Research' }, { label: 'Scoring' }]);
    expect(getCrumbs('/app/regime')).toEqual([{ label: 'Research' }, { label: 'Market Regime' }]);
    expect(getCrumbs('/app/nope')).toEqual([{ label: 'Page not found' }]);
    expect(getCrumbs('/app/executions')).toEqual([
      { label: 'Backtesting' },
      { label: 'Backtest history' },
    ]);
    expect(pageTitle('/app/portfolios/9')).toBe('Portfolio');
    expect(pageTitle('/app/portfolio-backtests/new')).toBe('New portfolio backtest');
    expect(pageTitle('/app/portfolio-backtests/9')).toBe('Portfolio backtest');
  });

  it('results sit under Backtest history', () => {
    expect(pageTitle('/app/executions/7/results')).toBe('Backtest results');
    expect(getCrumbs('/app/executions/7/results')).toEqual([
      { label: 'Backtesting' },
      { label: 'Backtest history', to: '/app/executions' },
      { label: 'Backtest results' },
    ]);
  });
});
