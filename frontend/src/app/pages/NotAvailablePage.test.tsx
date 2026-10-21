import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { NotAvailablePage } from './NotAvailablePage';

function renderPage(reason: 'planned' | 'disabled') {
  render(
    <MemoryRouter>
      <NotAvailablePage title="Market Regime" reason={reason} />
    </MemoryRouter>,
  );
}

describe('NotAvailablePage', () => {
  it('explains planned features', () => {
    renderPage('planned');
    expect(screen.getByRole('heading', { name: 'Market Regime is planned' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'href',
      '/app/dashboard',
    );
  });

  it('explains disabled areas without showing anything else', () => {
    renderPage('disabled');
    expect(
      screen.getByRole('heading', { name: 'Market Regime is not available' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing here can be viewed or changed/)).toBeInTheDocument();
  });
});
