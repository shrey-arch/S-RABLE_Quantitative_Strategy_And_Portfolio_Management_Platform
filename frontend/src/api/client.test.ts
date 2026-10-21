import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setUnauthorizedHandler, unwrap } from './client';
import { tokenStore } from './token';

const response = (status: number) => new Response(null, { status });

afterEach(() => {
  tokenStore.clear();
  setUnauthorizedHandler(null);
});

describe('unwrap', () => {
  it('returns data on success', async () => {
    const data = await unwrap(Promise.resolve({ data: { id: '1' }, response: response(200) }));
    expect(data).toEqual({ id: '1' });
  });

  it('throws a normalised ApiError on an error status', async () => {
    const call = unwrap(
      Promise.resolve({ error: { detail: 'Not authenticated' }, response: response(401) }),
    );
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toMatchObject({ status: 401, message: 'Not authenticated' });
  });

  it('throws a network error (status 0) when the request itself fails', async () => {
    await expect(unwrap(Promise.reject(new TypeError('Failed to fetch')))).rejects.toMatchObject({
      status: 0,
    });
  });
});

describe('session handling in the client', () => {
  const stubFetch = (status: number, body: unknown) => {
    const fetchMock = vi.fn(
      async (_req: Request) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    return fetchMock;
  };

  it('sends the bearer token on every request', async () => {
    const fetchMock = stubFetch(200, []);
    tokenStore.set('t1');
    await api.GET('/strategies', { baseUrl: 'http://test', fetch: fetchMock });
    const sent = fetchMock.mock.calls[0]![0];
    expect(sent.headers.get('Authorization')).toBe('Bearer t1');
  });

  it('ends the session when a request WITH a token gets 401', async () => {
    const fetchMock = stubFetch(401, { detail: 'Invalid or expired token.' });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    tokenStore.set('expired');
    await api.GET('/users/me', { baseUrl: 'http://test', fetch: fetchMock });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBeNull();
  });

  it('ignores 401 from login (wrong password is not a session event)', async () => {
    const fetchMock = stubFetch(401, { detail: 'Invalid email or password.' });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    tokenStore.set('t1');
    await api.POST('/auth/login', {
      baseUrl: 'http://test',
      fetch: fetchMock,
      body: { email: 'a@b.com', password: 'wrongpass' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores 401 on requests sent without a token (no redirect loop)', async () => {
    const fetchMock = stubFetch(401, { detail: 'Not authenticated' });
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    await api.GET('/users/me', { baseUrl: 'http://test', fetch: fetchMock });
    expect(handler).not.toHaveBeenCalled();
  });
});
