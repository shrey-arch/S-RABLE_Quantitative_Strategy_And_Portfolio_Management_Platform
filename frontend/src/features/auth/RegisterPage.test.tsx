import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { AuthContext, type AuthContextValue } from './auth-context';
import RegisterPage from './RegisterPage';

function LoginProbe() {
  const location = useLocation();
  return <h1>Login {JSON.stringify(location.state)}</h1>;
}

function renderRegister(auth: Partial<AuthContextValue> = {}) {
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
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginProbe />} />
          <Route path="/app/dashboard" element={<h1>Dashboard</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const fill = (v: { name?: string; email?: string; password?: string; confirm?: string }) => {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: v.name ?? '' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: v.email ?? '' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: v.password ?? '' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: v.confirm ?? '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
};

const valid = { name: ' Asha Rao ', email: ' asha@example.com ', password: 'password123' };

/** Fakes the backend reply to POST /auth/register. */
const mockPost = (status: number, body: unknown) =>
  vi.spyOn(api, 'POST').mockImplementation((() =>
    Promise.resolve({
      ...(status < 300 ? { data: body } : { error: body }),
      response: new Response(null, { status }),
    })) as never);

afterEach(() => vi.restoreAllMocks());

describe('RegisterPage', () => {
  it('validates with the backend limits before sending', async () => {
    const post = mockPost(201, {});
    renderRegister();
    fill({ name: 'A', email: 'bad', password: 'short', confirm: 'other' });
    expect(await screen.findByText('Name must be at least 2 characters.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends trimmed values (never the confirmation) and goes to login with the email', async () => {
    const post = mockPost(201, { id: '1' });
    renderRegister();
    fill({ ...valid, confirm: valid.password });
    expect(await screen.findByRole('heading', { name: /Login/ })).toHaveTextContent(
      '"registeredEmail":"asha@example.com"',
    );
    expect(post).toHaveBeenCalledWith('/auth/register', {
      body: { full_name: 'Asha Rao', email: 'asha@example.com', password: 'password123' },
    });
  });

  it('shows "email already exists" under the email field on 409', async () => {
    mockPost(409, { detail: 'A user with this email already exists.' });
    renderRegister();
    fill({ ...valid, confirm: valid.password });
    expect(await screen.findByText(/already exists\. Log in instead/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('puts backend 422 messages under the matching field', async () => {
    mockPost(422, {
      detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email', type: 'value_error' }],
    });
    renderRegister();
    fill({ ...valid, confirm: valid.password });
    expect(await screen.findByText('value is not a valid email')).toBeInTheDocument();
  });

  it('shows other failures in one alert, without server internals', async () => {
    mockPost(500, { detail: 'Traceback: secret' });
    renderRegister();
    fill({ ...valid, confirm: valid.password });
    expect(
      await screen.findByText('The server had a problem. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Traceback/)).not.toBeInTheDocument();
  });

  it('sends already logged-in users to the app', () => {
    renderRegister({ state: { status: 'authenticated', user: {} as never } });
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });
});
