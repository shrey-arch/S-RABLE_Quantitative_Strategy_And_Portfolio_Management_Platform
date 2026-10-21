import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import LandingPage from './LandingPage';

function renderLanding(auth: Partial<AuthContextValue> = {}) {
  const value: AuthContextValue = {
    state: { status: 'anonymous', user: null },
    login: vi.fn(),
    logout: vi.fn(),
    expiresAt: null,
    endReason: null,
    updateUser: vi.fn(),
    ...auth,
  };
  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('LandingPage', () => {
  it('offers Get started and Log in to visitors', () => {
    renderLanding();
    expect(screen.getAllByRole('link', { name: /Get started/ })[0]).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
  });

  it('shows the three pillars', () => {
    renderLanding();
    for (const title of [
      'Strategy library and builder',
      'Five-stage validation',
      'Regime-aware portfolio',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it('marks only the backtest stage as available; the rest are planned', () => {
    renderLanding();
    const pillar = screen.getByRole('heading', { name: 'Five-stage validation' }).parentElement!;
    const stages = within(pillar).getAllByRole('listitem');
    expect(stages).toHaveLength(5);
    expect(stages[0]).toHaveTextContent('Backtest');
    expect(stages[0]).toHaveTextContent('Available');
    for (const stage of stages.slice(1)) expect(stage).toHaveTextContent('Planned');
  });

  it('never implies live trading', () => {
    renderLanding();
    expect(screen.getAllByText(/Historical simulation/).length).toBeGreaterThan(0);
    expect(screen.getByText(/does not place live trades/)).toBeInTheDocument();
  });

  it('logged-in users get a link to the dashboard instead', () => {
    renderLanding({ state: { status: 'authenticated', user: {} as never } });
    expect(screen.queryByRole('link', { name: /Get started/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Open dashboard/ })[0]).toHaveAttribute(
      'href',
      '/app/dashboard',
    );
  });
});
