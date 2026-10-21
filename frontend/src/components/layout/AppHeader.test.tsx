import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { AppHeader } from './AppHeader';
import { initials } from '@/lib/initials';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

afterEach(() => vi.restoreAllMocks());

function renderHeader(path: string, logout = vi.fn(), unread: number | null = 0) {
  vi.spyOn(api, 'GET').mockImplementation(((url: string) =>
    url === '/notifications/unread-count'
      ? unread === null
        ? respond(500, { detail: 'down' })
        : respond(200, { unread })
      : Promise.reject(new Error(`unexpected GET ${url}`))) as never);
  const value: AuthContextValue = {
    state: {
      status: 'authenticated',
      user: { full_name: 'Asha Rao', email: 'asha@example.com' } as never,
    },
    login: vi.fn(),
    logout,
    expiresAt: null,
    endReason: null,
    updateUser: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[path]}>
          <AppHeader />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return logout;
}

describe('AppHeader', () => {
  it('shows breadcrumbs ending in the current page', () => {
    renderHeader('/app/strategies/123');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Strategies' })).toHaveAttribute(
      'href',
      '/app/strategies',
    );
    expect(within(nav).getByText('Strategy')).toHaveAttribute('aria-current', 'page');
  });

  it('user menu shows the user and logs out', async () => {
    const logout = renderHeader('/app/dashboard');
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger).toHaveTextContent('AR');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByText('asha@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/app/profile',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));
    expect(logout).toHaveBeenCalledOnce();
  });

  it('the bell shows the unread count from the API and opens the notifications page', async () => {
    renderHeader('/app/dashboard', vi.fn(), 3);
    const bell = await screen.findByRole('link', { name: 'Notifications, 3 unread' });
    expect(bell).toHaveAttribute('href', '/app/notifications');
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('3');
  });

  it('the bell shows no number when nothing is unread or the count fails', async () => {
    renderHeader('/app/dashboard', vi.fn(), 0);
    expect(await screen.findByRole('link', { name: 'Notifications, none unread' })).toBeVisible();
    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('a failed count leaves the bell without a number', async () => {
    renderHeader('/app/dashboard', vi.fn(), null);
    const bell = screen.getByRole('link', { name: 'Notifications' });
    await new Promise((r) => setTimeout(r, 20));
    expect(bell).toHaveAccessibleName('Notifications');
    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('initials handle odd names', () => {
    expect(initials('asha rao')).toBe('AR');
    expect(initials('  Madonna ')).toBe('M');
    expect(initials('')).toBe('?');
  });
});
