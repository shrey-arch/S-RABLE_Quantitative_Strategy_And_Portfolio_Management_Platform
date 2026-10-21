import { expect, test, type Page } from '@playwright/test';
import { accountName, type BrokerAccount } from '../../src/features/brokers/broker-model';
import {
  FX_BROKER_DUPLICATE,
  FX_BROKERS,
  FX_NOTIFICATIONS,
  FX_PROFILE,
  FX_PROFILE_SAVED,
} from '../../src/features/notifications/account-fixture';
import type { Notification } from '../../src/features/notifications/notification-model';

/**
 * Phase 16: notifications, broker accounts and profile in a real browser. A fake
 * of the API keeps changes in memory and answers as the backend does (the
 * answers come from the backend's own code, see account-fixture.ts).
 */

interface Fake {
  notifications: Notification[];
  brokers: BrokerAccount[];
  user: typeof FX_PROFILE;
  bodies: { method: string; path: string; body: unknown }[];
}

const unreadOf = (fake: Fake) => fake.notifications.filter((n) => !n.is_read).length;

async function open(page: Page, path: string) {
  const fake: Fake = {
    notifications: FX_NOTIFICATIONS.map((n) => ({ ...n })),
    brokers: FX_BROKERS.map((b) => ({ ...b })),
    user: { ...FX_PROFILE },
    bodies: [],
  };
  await page.route(
    (url) =>
      url.pathname === '/users/me' ||
      /^\/(notifications|brokers|validations|executions)(\/|$)/.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      const p = url.pathname;
      const method = request.method();
      const body = request.postData() ? (JSON.parse(request.postData()!) as unknown) : null;
      if (method !== 'GET') fake.bodies.push({ method, path: p, body });
      if (p === '/users/me') {
        if (method === 'PATCH') fake.user = { ...FX_PROFILE_SAVED };
        return route.fulfill({ json: fake.user });
      }
      if (p === '/notifications/unread-count')
        return route.fulfill({ json: { unread: unreadOf(fake) } });
      if (p === '/notifications') {
        const unreadOnly = url.searchParams.get('is_read') === 'false';
        const type = url.searchParams.get('notification_type');
        return route.fulfill({
          json: fake.notifications.filter(
            (n) => (!unreadOnly || !n.is_read) && (!type || n.notification_type === type),
          ),
        });
      }
      if (p.startsWith('/notifications/')) {
        const id = p.split('/')[2];
        if (method === 'DELETE') {
          fake.notifications = fake.notifications.filter((n) => n.id !== id);
          return route.fulfill({ status: 204, body: '' });
        }
        const isRead = (body as { is_read: boolean }).is_read;
        fake.notifications = fake.notifications.map((n) =>
          n.id === id
            ? { ...n, is_read: isRead, read_at: isRead ? new Date().toISOString() : null }
            : n,
        );
        return route.fulfill({ json: fake.notifications.find((n) => n.id === id) });
      }
      if (p === '/brokers/accounts') {
        if (method === 'GET') return route.fulfill({ json: fake.brokers });
        const b = body as { broker_name: string; broker_user_id: string; account_alias: string };
        if (
          fake.brokers.some(
            (x) => x.broker_name === b.broker_name && x.broker_user_id === b.broker_user_id,
          )
        )
          return route.fulfill({ status: 409, json: FX_BROKER_DUPLICATE });
        const created: BrokerAccount = {
          id: `b0000000-0000-4000-8000-00000000000${fake.brokers.length + 1}`,
          broker_name: b.broker_name,
          broker_user_id: b.broker_user_id,
          account_alias: b.account_alias,
          connection_status: 'DISCONNECTED',
          is_active: true,
          last_synced_at: null,
          created_at: new Date().toISOString(),
        };
        fake.brokers = [created, ...fake.brokers];
        return route.fulfill({ status: 201, json: created });
      }
      if (p.startsWith('/brokers/accounts/')) {
        const [, , , id, action] = p.split('/');
        if (method === 'DELETE') {
          fake.brokers = fake.brokers.filter((x) => x.id !== id);
          return route.fulfill({ status: 204, body: '' });
        }
        fake.brokers = fake.brokers.map((x) =>
          x.id !== id
            ? x
            : action === 'connect'
              ? { ...x, connection_status: 'CONNECTED' }
              : action === 'disconnect'
                ? { ...x, connection_status: 'DISCONNECTED' }
                : { ...x, ...(body as object) },
        );
        return route.fulfill({ json: fake.brokers.find((x) => x.id === id) });
      }
      // Pages a notification opens: the run is not part of this fake.
      return route.fulfill({ status: 404, json: { detail: 'Not found.' } });
    },
  );
  await page.addInitScript(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem('srable.session', `${b64({ alg: 'HS256' })}.${b64({ exp })}.test`);
  });
  await page.goto(path);
  return fake;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('notifications: mark read updates the bell, Unread tab, delete, and a run opens', async ({
  page,
}) => {
  const fake = await open(page, '/app/notifications');
  const bell = page.getByRole('link', { name: /^Notifications, / });
  await expect(bell).toHaveAccessibleName('Notifications, 2 unread');
  const list = page.getByRole('list', { name: 'Notification list' }).getByRole('listitem');
  await expect(list).toHaveCount(FX_NOTIFICATIONS.length);
  await expect(list.first()).toContainText(FX_NOTIFICATIONS[0]!.message);
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await list
    .first()
    .getByRole('button', { name: /^Mark read/ })
    .click();
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');
  expect(fake.bodies.at(-1)).toEqual({
    method: 'PATCH',
    path: `/notifications/${FX_NOTIFICATIONS[0]!.id}`,
    body: { is_read: true },
  });

  await page.getByRole('tab', { name: /Unread/ }).click();
  await expect(page).toHaveURL(/tab=unread/);
  await expect(list).toHaveCount(1);
  await page.reload();
  await expect(list).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Unread (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('tab', { name: 'All' }).click();
  await expect(list).toHaveCount(FX_NOTIFICATIONS.length);
  await list
    .last()
    .getByRole('button', { name: /^Delete/ })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(list).toHaveCount(FX_NOTIFICATIONS.length - 1);

  // A failed validation opens its report and is marked read.
  const failed = FX_NOTIFICATIONS[1]!;
  await page.getByRole('link', { name: /Open validation report/ }).click();
  await expect(page).toHaveURL(`/app/validation/${failed.execution_id}`);
  await expect(bell).toHaveAccessibleName('Notifications, none unread');
});

test('brokers: add (secrets write-only), 409, connect, disconnect, edit and delete', async ({
  page,
}) => {
  const fake = await open(page, '/app/brokers');
  await expect(page.getByRole('heading', { level: 1, name: 'Brokers' })).toBeVisible();
  const cards = page.getByRole('list', { name: 'Broker accounts' }).getByRole('listitem');
  await expect(cards).toHaveCount(FX_BROKERS.length);
  const zerodha = FX_BROKERS.find((b) => b.broker_name === 'ZERODHA')!;
  await expect(page.getByRole('listitem', { name: accountName(zerodha) })).toContainText(
    'CONNECTED',
  );

  // Add, then the same identity again (409).
  for (const attempt of ['first', 'again']) {
    await page.getByRole('button', { name: /Add broker account/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Broker' }).selectOption('DHAN');
    await dialog.getByLabel(/Broker user ID/).fill('D-77');
    await dialog.getByLabel(/Alias/).fill('Spare');
    await dialog.getByLabel(/API key/).fill('typed-key-123');
    await dialog.getByLabel(/API secret/).fill('typed-secret-456');
    await dialog.getByRole('button', { name: 'Save account' }).click();
    if (attempt === 'first') await expect(page.getByRole('dialog')).toHaveCount(0);
    else {
      await expect(dialog.getByRole('alert')).toHaveText(FX_BROKER_DUPLICATE.detail);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
  await expect(cards).toHaveCount(FX_BROKERS.length + 1);
  expect(await page.content()).not.toContain('typed-secret-456');
  expect(await page.content()).not.toContain('typed-key-123');

  const dhan = page.getByRole('listitem', { name: /Dhan/ });
  await expect(dhan).toContainText('DISCONNECTED');
  await dhan.getByRole('button', { name: /^Connect/ }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/Access token/)
    .fill('typed-token-789');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(dhan).toContainText('CONNECTED');
  expect(fake.bodies.at(-1)!.body).toEqual({
    access_token: 'typed-token-789',
    refresh_token: null,
  });
  expect(await page.content()).not.toContain('typed-token-789');

  await dhan.getByRole('button', { name: /Disconnect/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(dhan).toContainText('DISCONNECTED');

  await dhan.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('dialog').getByLabel(/Alias/).fill('Backup');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('listitem', { name: /Dhan \u00b7 Backup/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await page
    .getByRole('listitem', { name: /Dhan \u00b7 Backup/ })
    .getByRole('button', { name: /^Delete/ })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(cards).toHaveCount(FX_BROKERS.length);
});

test('profile: shows the account and saves only the accepted fields', async ({ page }) => {
  const fake = await open(page, '/app/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible();
  const details = page.getByRole('region', { name: 'Account details' });
  await expect(details).toContainText(FX_PROFILE.email);
  await expect(details).toContainText('Active');
  const form = page.getByRole('form', { name: 'Edit profile' });
  await form.getByLabel(/Full name/).fill(FX_PROFILE_SAVED.full_name);
  await form.getByLabel(/Phone number/).fill('');
  await form.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText(
    FX_PROFILE_SAVED.full_name,
  );
  expect(fake.bodies.at(-1)).toEqual({
    method: 'PATCH',
    path: '/users/me',
    body: { full_name: FX_PROFILE_SAVED.full_name, phone_number: '' },
  });
  await expect(details).toContainText('Not set');
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});
