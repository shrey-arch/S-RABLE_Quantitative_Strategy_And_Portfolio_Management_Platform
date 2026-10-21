import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import {
  FX_BROKER_CONNECTED,
  FX_BROKER_DISCONNECTED,
  FX_BROKER_DUPLICATE,
  FX_BROKERS,
} from '@/features/notifications/account-fixture';
import BrokersPage from './BrokersPage';
import { accountName, CONNECTION_NOTE, type BrokerAccount } from './broker-model';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

// The Active switch measures itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

type Init = { params?: { path?: Record<string, string> }; body?: Record<string, unknown> };

const SECRET_VALUES = ['key-typed-123', 'secret-typed-456', 'token-typed-789', 'refresh-typed-0'];

function setup(opts: { createStatus?: number } = {}) {
  let accounts: BrokerAccount[] = FX_BROKERS.map((a) => ({ ...a }));
  vi.spyOn(api, 'GET').mockImplementation(((url: string) => {
    if (url === '/brokers/accounts') return respond(200, accounts);
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const post = vi.spyOn(api, 'POST').mockImplementation(((url: string, init: Init) => {
    if (url === '/brokers/accounts') {
      if (opts.createStatus === 409) return respond(409, FX_BROKER_DUPLICATE);
      const created: BrokerAccount = {
        id: 'b0000000-0000-4000-8000-000000000009',
        broker_name: init.body!.broker_name as string,
        broker_user_id: init.body!.broker_user_id as string,
        account_alias: (init.body!.account_alias as string | null) ?? null,
        connection_status: 'DISCONNECTED',
        is_active: true,
        last_synced_at: null,
        created_at: '2026-10-17T18:10:00+00:00',
      };
      accounts = [created, ...accounts];
      return respond(201, created);
    }
    const id = init.params!.path!.broker_account_id;
    const answer = url.endsWith('/connect') ? FX_BROKER_CONNECTED : FX_BROKER_DISCONNECTED;
    accounts = accounts.map((a) =>
      a.id === id ? { ...a, connection_status: answer.connection_status } : a,
    );
    return respond(
      200,
      accounts.find((a) => a.id === id),
    );
  }) as never);
  const patch = vi.spyOn(api, 'PATCH').mockImplementation(((_url: string, init: Init) => {
    const id = init.params!.path!.broker_account_id;
    const b = init.body!;
    accounts = accounts.map((a) =>
      a.id === id
        ? {
            ...a,
            account_alias:
              b.account_alias === undefined ? a.account_alias : (b.account_alias as string) || null,
            is_active: (b.is_active as boolean | undefined) ?? a.is_active,
          }
        : a,
    );
    return respond(
      200,
      accounts.find((a) => a.id === id),
    );
  }) as never);
  const del = vi.spyOn(api, 'DELETE').mockImplementation(((_url: string, init: Init) => {
    accounts = accounts.filter((a) => a.id !== init.params!.path!.broker_account_id);
    return respond(204, undefined);
  }) as never);
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <BrokersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { post, patch, del, view };
}

const card = async (account: BrokerAccount) =>
  screen.findByRole('listitem', { name: accountName(account) });
const upstox = FX_BROKERS.find((a) => a.broker_name === 'UPSTOX')!;
const zerodha = FX_BROKERS.find((a) => a.broker_name === 'ZERODHA')!;
const noSecretsShown = (container: HTMLElement) => {
  for (const value of SECRET_VALUES) expect(container.innerHTML).not.toContain(value);
};

afterEach(() => vi.restoreAllMocks());

describe('BrokersPage', () => {
  it('lists the accounts with the connection status exactly as returned', async () => {
    setup();
    expect(screen.getByRole('note')).toHaveTextContent(CONNECTION_NOTE);
    const z = await card(zerodha);
    expect(z).toHaveTextContent('Zerodha');
    expect(z).toHaveTextContent('AB1234');
    expect(z).toHaveTextContent('Main');
    expect(z).toHaveTextContent('CONNECTED');
    expect(z).toHaveTextContent('Active');
    expect(z).toHaveTextContent('Never');
    expect(within(z).getByRole('button', { name: /Disconnect/ })).toBeVisible();
    const u = await card(upstox);
    expect(u).toHaveTextContent('DISCONNECTED');
    expect(u).toHaveTextContent('Inactive');
    expect(u).toHaveTextContent('None');
    expect(within(u).getByRole('button', { name: /^Connect/ })).toBeVisible();
    // Nothing on the page offers trading.
    expect(screen.queryByRole('button', { name: /trade|order|buy|sell/i })).toBeNull();
  });

  it('adds an account; the secrets are sent once and never shown again', async () => {
    const { post, view } = setup();
    await card(zerodha);
    fireEvent.click(screen.getByRole('button', { name: /Add broker account/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Broker\*?$/), { target: { value: 'DHAN' } });
    fireEvent.change(within(dialog).getByLabelText(/Broker user ID/), {
      target: { value: ' D-77 ' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Alias/), { target: { value: 'Spare' } });
    const key = within(dialog).getByLabelText(/API key/);
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: SECRET_VALUES[0] } });
    fireEvent.change(within(dialog).getByLabelText(/API secret/), {
      target: { value: SECRET_VALUES[1] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save account' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).toHaveBeenCalledWith('/brokers/accounts', {
      body: {
        broker_name: 'DHAN',
        broker_user_id: 'D-77',
        account_alias: 'Spare',
        api_key: SECRET_VALUES[0],
        api_secret: SECRET_VALUES[1],
      },
    });
    expect(await screen.findByRole('listitem', { name: /Dhan/ })).toHaveTextContent('D-77');
    noSecretsShown(view.container);
    // Opening the form again starts empty.
    fireEvent.click(screen.getByRole('button', { name: /Add broker account/ }));
    const again = await screen.findByRole('dialog');
    expect(within(again).getByLabelText(/API key/)).toHaveValue('');
    expect(within(again).getByLabelText(/API secret/)).toHaveValue('');
  });

  it('checks the form before sending', async () => {
    const { post } = setup();
    await card(zerodha);
    fireEvent.click(screen.getByRole('button', { name: /Add broker account/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save account' }));
    expect(await within(dialog).findByText('Enter the broker user ID.')).toBeVisible();
    expect(within(dialog).getByText('Enter the API key.')).toBeVisible();
    expect(within(dialog).getByText('Enter the API secret.')).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the 409 duplicate message', async () => {
    setup({ createStatus: 409 });
    await card(zerodha);
    fireEvent.click(screen.getByRole('button', { name: /Add broker account/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Broker user ID/), {
      target: { value: 'AB1234' },
    });
    fireEvent.change(within(dialog).getByLabelText(/API key/), { target: { value: 'k' } });
    fireEvent.change(within(dialog).getByLabelText(/API secret/), { target: { value: 's' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save account' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(FX_BROKER_DUPLICATE.detail);
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('connect stores the tokens and disconnect asks first', async () => {
    const { post, view } = setup();
    fireEvent.click(within(await card(upstox)).getByRole('button', { name: /^Connect/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('it does not enable trading');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(await within(dialog).findByText('Enter the access token.')).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText(/Access token/), {
      target: { value: SECRET_VALUES[2] },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).toHaveBeenCalledWith('/brokers/accounts/{broker_account_id}/connect', {
      params: { path: { broker_account_id: upstox.id } },
      body: { access_token: SECRET_VALUES[2], refresh_token: null },
    });
    await waitFor(async () => expect(await card(upstox)).toHaveTextContent('CONNECTED'));
    noSecretsShown(view.container);

    fireEvent.click(within(await card(upstox)).getByRole('button', { name: /Disconnect/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/brokers/accounts/{broker_account_id}/disconnect', {
        params: { path: { broker_account_id: upstox.id } },
      }),
    );
    await waitFor(async () => expect(await card(upstox)).toHaveTextContent('DISCONNECTED'));
  });

  it('edit changes only the alias and active; an empty alias clears it', async () => {
    const { patch } = setup();
    fireEvent.click(within(await card(zerodha)).getByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    const alias = within(dialog).getByLabelText(/Alias/);
    expect(alias).toHaveValue('Main');
    expect(within(dialog).queryByLabelText(/API/)).toBeNull();
    fireEvent.change(alias, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Active' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patch).toHaveBeenCalledWith('/brokers/accounts/{broker_account_id}', {
      params: { path: { broker_account_id: zerodha.id } },
      body: { account_alias: '', is_active: false },
    });
    const renamed = { ...zerodha, account_alias: null };
    await waitFor(async () => expect(await card(renamed)).toHaveTextContent('Inactive'));
  });

  it('delete asks first and sends one DELETE', async () => {
    const { del } = setup();
    fireEvent.click(
      within(await card(upstox)).getByRole('button', { name: `Delete ${accountName(upstox)}` }),
    );
    const confirm = await screen.findByRole('alertdialog');
    const yes = within(confirm).getByRole('button', { name: 'Delete' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(del).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: accountName(upstox) })).toBeNull(),
    );
  });
});
