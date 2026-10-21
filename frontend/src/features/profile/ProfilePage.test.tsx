import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import {
  FX_PROFILE,
  FX_PROFILE_INVALID,
  FX_PROFILE_SAVED,
} from '@/features/notifications/account-fixture';
import { formatDateTime } from '@/lib/format';
import ProfilePage from './ProfilePage';
import { buildUpdate, draftOf } from './profile-model';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

function setup(
  answer: { status: number; body: unknown } = { status: 200, body: FX_PROFILE_SAVED },
) {
  const patch = vi
    .spyOn(api, 'PATCH')
    .mockImplementation((() => respond(answer.status, answer.body)) as never);
  const updateUser = vi.fn();
  const auth: AuthContextValue = {
    state: { status: 'authenticated', user: FX_PROFILE },
    login: vi.fn(),
    logout: vi.fn(),
    expiresAt: null,
    endReason: null,
    updateUser,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { patch, updateUser };
}

const form = () => screen.getByRole('form', { name: 'Edit profile' });

afterEach(() => vi.restoreAllMocks());

describe('ProfilePage', () => {
  it('shows the account as returned; email, status and verification are read-only', () => {
    setup();
    const details = screen.getByRole('region', { name: 'Account details' });
    expect(details).toHaveTextContent(FX_PROFILE.email);
    expect(details).toHaveTextContent(FX_PROFILE.phone_number!);
    expect(details).toHaveTextContent('Active');
    expect(details).toHaveTextContent('Email verifiedNo');
    expect(details).toHaveTextContent(formatDateTime(FX_PROFILE.last_login_at));
    expect(details).toHaveTextContent(formatDateTime(FX_PROFILE.created_at));
    const editable = within(form())
      .getAllByRole('textbox')
      .map((el) => el.getAttribute('type') ?? 'text');
    expect(editable).toHaveLength(3);
    expect(within(form()).queryByLabelText(/Email/)).toBeNull();
    expect(within(form()).getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('sends only the changed fields and updates the logged-in user', async () => {
    const { patch, updateUser } = setup();
    fireEvent.change(within(form()).getByLabelText(/Full name/), {
      target: { value: 'Asha R. Rao' },
    });
    fireEvent.change(within(form()).getByLabelText(/Phone number/), { target: { value: '' } });
    fireEvent.click(within(form()).getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith(FX_PROFILE_SAVED));
    expect(patch).toHaveBeenCalledWith('/users/me', {
      body: { full_name: 'Asha R. Rao', phone_number: '' },
    });
  });

  it("shows the backend's 422 reason on the field", async () => {
    const { patch, updateUser } = setup({ status: 422, body: FX_PROFILE_INVALID });
    // The browser check passes (https), the backend still has the last word.
    fireEvent.change(within(form()).getByLabelText(/Profile image URL/), {
      target: { value: 'https://example.com/a.png' },
    });
    fireEvent.click(within(form()).getByRole('button', { name: 'Save profile' }));
    expect(
      await within(form()).findByText('Profile image URL must start with http:// or https://.'),
    ).toBeVisible();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('checks the fields before sending', () => {
    expect(
      buildUpdate(FX_PROFILE, { ...draftOf(FX_PROFILE), profile_image_url: 'ftp://x' }),
    ).toEqual({ ok: false, errors: { profile_image_url: 'Must start with http:// or https://.' } });
    expect(buildUpdate(FX_PROFILE, { ...draftOf(FX_PROFILE), full_name: ' a ' })).toEqual({
      ok: false,
      errors: { full_name: 'At least 2 characters.' },
    });
    expect(buildUpdate(FX_PROFILE, { ...draftOf(FX_PROFILE), phone_number: 'call me' })).toEqual({
      ok: false,
      errors: { phone_number: 'Digits, spaces and + - ( ) only.' },
    });
    expect(buildUpdate(FX_PROFILE, draftOf(FX_PROFILE))).toEqual({ ok: true, value: {} });
  });
});
