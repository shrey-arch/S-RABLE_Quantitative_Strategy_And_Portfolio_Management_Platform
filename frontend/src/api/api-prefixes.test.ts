import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_PREFIXES } from './api-prefixes';

describe('dev proxy prefixes', () => {
  it('cover every backend path in openapi.json', () => {
    const spec = JSON.parse(readFileSync('openapi/openapi.json', 'utf8')) as {
      paths: Record<string, unknown>;
    };
    // "/" (the backend root) is never proxied: it is the React app's home page.
    const prefixes = new Set(
      Object.keys(spec.paths)
        .filter((p) => p !== '/')
        .map((p) => `/${p.split('/')[1]}`),
    );
    const missing = [...prefixes].filter((p) => !API_PREFIXES.includes(p));
    expect(missing).toEqual([]);
  });
});
