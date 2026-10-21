import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { formatDateTime } from '@/lib/format';
import { FX_NOTIFICATIONS, FX_PROFILE, FX_UNREAD } from './account-fixture';
import { NotificationBell } from './NotificationBell';
import NotificationsPage from './NotificationsPage';
import { notificationLink, type Notification } from './notification-model';

const respond = (status: number, body: unknown) =>
  Promise.resolve({
    ...(status < 300 ? { data: body } : { error: body }),
    response: new Response(null, { status }),
  });

type Init = {
  params?: { query?: Record<string, unknown>; path?: Record<string, string> };
  body?: { is_read: boolean };
};

/** A stand-in for the backend: filters as the API does and keeps changes. */
function setup(path = '/app/notifications') {
  let items: Notification[] = FX_NOTIFICATIONS.map((n) => ({ ...n }));
  const get = vi.spyOn(api, 'GET').mockImplementation(((url: string, init?: Init) => {
    if (url === '/notifications/unread-count')
      return respond(200, { unread: items.filter((n) => !n.is_read).length });
    if (url === '/notifications') {
      const q = init?.params?.query ?? {};
      return respond(
        200,
        items.filter(
          (n) =>
            (q.is_read === undefined || n.is_read === q.is_read) &&
            (!q.notification_type || n.notification_type === q.notification_type) &&
            (!q.priority || n.priority === q.priority),
        ),
      );
    }
    throw new Error(`unexpected GET ${url}`);
  }) as never);
  const patch = vi.spyOn(api, 'PATCH').mockImplementation(((_url: string, init: Init) => {
    const id = init.params!.path!.notification_id;
    items = items.map((n) =>
      n.id === id
        ? {
            ...n,
            is_read: init.body!.is_read,
            read_at: init.body!.is_read ? '2026-10-17T18:30:00+00:00' : null,
          }
        : n,
    );
    return respond(
      200,
      items.find((n) => n.id === id),
    );
  }) as never);
  const del = vi.spyOn(api, 'DELETE').mockImplementation(((_url: string, init: Init) => {
    items = items.filter((n) => n.id !== init.params!.path!.notification_id);
    return respond(204, undefined);
  }) as never);
  function Where() {
    const l = useLocation();
    return <div data-testid="where">{l.pathname + l.search}</div>;
  }
  const auth: AuthContextValue = {
    state: { status: 'authenticated', user: FX_PROFILE },
    login: vi.fn(),
    logout: vi.fn(),
    expiresAt: null,
    endReason: null,
    updateUser: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <NotificationBell />
          <Routes>
            <Route path="/app/notifications" element={<NotificationsPage />} />
            <Route path="*" element={<p>other page</p>} />
          </Routes>
          <Where />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  const listCalls = () =>
    get.mock.calls
      .filter((c) => c[0] === '/notifications')
      .map((c) => (c[1] as Init | undefined)?.params?.query);
  return { get, patch, del, listCalls };
}

const items = async () =>
  within(await screen.findByRole('list', { name: 'Notification list' })).getAllByRole('listitem');

afterEach(() => vi.restoreAllMocks());

describe('NotificationsPage', () => {
  it('lists the notifications as returned, newest first, with their links', async () => {
    setup();
    const rows = await items();
    expect(rows).toHaveLength(FX_NOTIFICATIONS.length);
    FX_NOTIFICATIONS.forEach((n, i) => {
      const row = rows[i]!;
      expect(row).toHaveTextContent(n.title);
      expect(row).toHaveTextContent(n.message);
      expect(row).toHaveTextContent(formatDateTime(n.created_at));
      expect(row.textContent!.includes('Unread')).toBe(!n.is_read);
      const link = notificationLink(n);
      if (link)
        expect(within(row).getByRole('link', { name: new RegExp(link.label) })).toHaveAttribute(
          'href',
          link.to,
        );
      else expect(within(row).queryByRole('link')).toBeNull();
    });
    const [done, failed, cancelled] = FX_NOTIFICATIONS;
    expect(notificationLink(done!)!.to).toBe(`/app/executions/${done!.execution_id}/results`);
    expect(notificationLink(failed!)!.to).toBe(`/app/validation/${failed!.execution_id}`);
    expect(notificationLink(cancelled!)!.to).toBe(`/app/backtests/${cancelled!.execution_id}`);
    expect(rows[1]).toHaveTextContent('Error');
    expect(rows[1]).toHaveTextContent('High');
  });

  it('the bell count comes from the unread-count route', async () => {
    setup();
    expect(
      await screen.findByRole('link', { name: `Notifications, ${FX_UNREAD.unread} unread` }),
    ).toHaveAttribute('href', '/app/notifications');
    expect(await screen.findByRole('tab', { name: `Unread (${FX_UNREAD.unread})` })).toBeVisible();
  });

  it('mark read updates the bell, the list and read_at; mark unread undoes it', async () => {
    const { patch } = setup();
    const first = FX_NOTIFICATIONS[0]!;
    await screen.findByRole('link', { name: 'Notifications, 2 unread' });
    fireEvent.click(await screen.findByRole('button', { name: `Mark read: ${first.title}` }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/notifications/{notification_id}', {
        params: { path: { notification_id: first.id } },
        body: { is_read: true },
      }),
    );
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeVisible();
    const row = (await items())[0]!;
    await waitFor(() => expect(row).toHaveTextContent('read'));
    expect(within(row).getByRole('button', { name: /Mark unread/ })).toBeVisible();
    fireEvent.click(within(row).getByRole('button', { name: /Mark unread/ }));
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeVisible();
  });

  it('the Unread tab and the filters are sent to the API and kept in the address', async () => {
    const { listCalls } = setup();
    await items();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Unread/ }), { button: 0 });
    await waitFor(() => expect(listCalls().at(-1)).toEqual({ is_read: false }));
    expect(screen.getByTestId('where')).toHaveTextContent('tab=unread');
    expect(await items()).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), {
      target: { value: 'ERROR' },
    });
    await waitFor(() =>
      expect(listCalls().at(-1)).toEqual({ is_read: false, notification_type: 'ERROR' }),
    );
    expect(await items()).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
      target: { value: 'LOW' },
    });
    expect(await screen.findByText('No notifications match these filters')).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent('priority=LOW');
  });

  it('opening a run marks its notification read', async () => {
    const { patch } = setup();
    const failed = FX_NOTIFICATIONS[1]!;
    fireEvent.click(await screen.findByRole('link', { name: /Open validation report/ }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/notifications/{notification_id}', {
        params: { path: { notification_id: failed.id } },
        body: { is_read: true },
      }),
    );
    expect(screen.getByTestId('where')).toHaveTextContent(`/app/validation/${failed.execution_id}`);
  });

  it('delete asks first and sends one DELETE', async () => {
    const { del } = setup();
    const last = FX_NOTIFICATIONS.at(-1)!;
    const rows = await items();
    fireEvent.click(within(rows.at(-1)!).getByRole('button', { name: `Delete: ${last.title}` }));
    const confirm = await screen.findByRole('alertdialog');
    expect(del).not.toHaveBeenCalled();
    const yes = within(confirm).getByRole('button', { name: 'Delete' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/notifications/{notification_id}', {
      params: { path: { notification_id: last.id } },
    });
    await waitFor(async () => expect(await items()).toHaveLength(FX_NOTIFICATIONS.length - 1));
  });

  it('says so when there are none', async () => {
    vi.spyOn(api, 'GET').mockImplementation(((url: string) =>
      respond(200, url === '/notifications' ? [] : { unread: 0 })) as never);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <NotificationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No notifications yet')).toBeVisible();
    expect(screen.getByText(/completes, fails or is cancelled/)).toBeVisible();
  });
});
