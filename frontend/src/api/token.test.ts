import { afterEach, describe, expect, it } from 'vitest';
import { getTokenExpiry, tokenStore } from './token';

/** Builds an unsigned JWT-shaped string with the given payload (signature is irrelevant here). */
function fakeJwt(payload: object): string {
  const encode = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

afterEach(() => tokenStore.clear());

describe('tokenStore', () => {
  it('keeps the token in sessionStorage so a refresh keeps the session', () => {
    tokenStore.set('abc');
    expect(tokenStore.get()).toBe('abc');
    expect(sessionStorage.getItem('srable.session')).toBe('abc');
  });

  it('never uses localStorage', () => {
    tokenStore.set('abc');
    expect(Object.values({ ...localStorage })).not.toContain('abc');
  });

  it('clear() removes it from memory and storage', () => {
    tokenStore.set('abc');
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
    expect(sessionStorage.getItem('srable.session')).toBeNull();
  });
});

describe('getTokenExpiry', () => {
  it('reads the exp claim in milliseconds', () => {
    expect(getTokenExpiry(fakeJwt({ sub: 'u1', exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it('returns null for missing or malformed tokens', () => {
    expect(getTokenExpiry(null)).toBeNull();
    expect(getTokenExpiry('not-a-jwt')).toBeNull();
    expect(getTokenExpiry('a.@@@.c')).toBeNull();
    expect(getTokenExpiry(fakeJwt({ sub: 'u1' }))).toBeNull();
  });
});
