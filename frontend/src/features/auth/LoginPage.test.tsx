import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { AuthContext, type AuthContextValue } from './auth-context';
import LoginPage from './LoginPage';
import { safeReturnTo } from './return-to';

function renderLogin(auth: Partial<AuthContextValue>, state?: unknown) {
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
      <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/app/dashboard" element={<h1>Dashboard</h1>} />
          <Route path="/app/strategies" element={<h1>Strategies</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  return value;
}

const fill = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
};

describe('LoginPage', () => {
  it('validates before calling the backend', async () => {
    const auth = renderLogin({});
    fill('not-an-email', '');
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('shows one generic message for wrong credentials', async () => {
    renderLogin({
      login: vi.fn().mockRejectedValue(new ApiError(401, 'Invalid email or password.')),
    });
    fill('a@b.com', 'wrongpass1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('explains inactive or suspended accounts', async () => {
    renderLogin({
      login: vi.fn().mockRejectedValue(new ApiError(401, 'User account is not active.')),
    });
    fill('a@b.com', 'password123');
    expect(await screen.findByRole('alert')).toHaveTextContent(/not active/);
  });

  it('returns to the page the user originally asked for', async () => {
    const login = vi.fn().mockResolvedValue({});
    renderLogin({ login }, { from: '/app/strategies' });
    fill(' a@b.com ', 'password123');
    expect(await screen.findByRole('heading', { name: 'Strategies' })).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith('a@b.com', 'password123');
  });

  it('shows why the user was sent here after a session ended', () => {
    renderLogin({}, { reason: 'expired' });
    expect(screen.getByRole('status')).toHaveTextContent('Your session has ended');
  });

  it('shows the reason even when it comes from the session state', () => {
    renderLogin({ endReason: 'inactive' });
    expect(screen.getByRole('status')).toHaveTextContent(/not active/);
  });

  it('show/hide toggles the password visibility', () => {
    renderLogin({});
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('sends already logged-in users straight to the app', async () => {
    renderLogin({
      state: { status: 'authenticated', user: {} as never },
    });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument(),
    );
  });
});

describe('safeReturnTo', () => {
  it('allows only pages inside the app', () => {
    expect(safeReturnTo('/app/brokers')).toBe('/app/brokers');
    expect(safeReturnTo('https://evil.example')).toBe('/app/dashboard');
    expect(safeReturnTo('//evil.example')).toBe('/app/dashboard');
    expect(safeReturnTo('/login')).toBe('/app/dashboard');
    expect(safeReturnTo(undefined)).toBe('/app/dashboard');
  });
});
