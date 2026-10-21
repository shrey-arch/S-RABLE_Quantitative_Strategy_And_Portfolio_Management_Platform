import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from './routes';
import { NAV_GROUPS, isActive, type NavItem } from './nav';

const links = NAV_GROUPS.flatMap((g) => g.items).filter((i): i is NavItem => !i.planned);
const labels = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.label);

describe('sidebar navigation', () => {
  it('keeps the roadmap groups in order', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      'Workspace',
      'Research',
      'Backtesting',
      'Portfolio',
      'Account',
    ]);
  });

  it('every link points to a real route', () => {
    const paths = APP_ROUTES.map((r) => r.path);
    for (const item of links) expect(paths).toContain(item.to);
  });

  it('lists the account pages, notifications first', () => {
    const account = NAV_GROUPS.find((g) => g.label === 'Account')!;
    expect(account.items.map((i) => i.label)).toEqual(['Notifications', 'Brokers', 'Profile']);
    expect(labels).toContain('Trading Records');
  });

  it('lists deferred areas as planned only', () => {
    const planned = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.planned);
    expect(planned.map((i) => i.label)).toEqual([]);
  });

  it('highlights the section for pages inside it', () => {
    const strategies = links.find((i) => i.label === 'Strategies')!;
    expect(isActive(strategies, '/app/strategies')).toBe(true);
    expect(isActive(strategies, '/app/strategies/123')).toBe(true);
    expect(isActive(strategies, '/app/strategies-old')).toBe(false);
    const backtest = links.find((i) => i.label === 'New Backtest')!;
    expect(isActive(backtest, '/app/backtests/abc')).toBe(true);
    const history = links.find((i) => i.label === 'Backtest history')!;
    expect(isActive(history, '/app/executions')).toBe(true);
    expect(isActive(history, '/app/backtests/abc')).toBe(false);
    const validation = links.find((i) => i.label === 'Validation')!;
    expect(isActive(validation, '/app/validation/abc')).toBe(true);
    expect(isActive(validation, '/app/validation/new')).toBe(true);
    const portfolio = links.find((i) => i.label === 'Portfolio Backtest')!;
    expect(isActive(portfolio, '/app/portfolio-backtests/new')).toBe(true);
    expect(isActive(portfolio, '/app/portfolio-backtests/abc')).toBe(true);
    expect(isActive(portfolio, '/app/portfolios')).toBe(false);
  });
});
