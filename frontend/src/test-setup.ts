/**
 * Runs before every test file.
 * Adds DOM matchers such as toBeInTheDocument() and cleans up rendered components after each test.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy* and waitFor give up after 1 s by default. On a slower machine running every
// file in parallel, a mocked request can take longer than that, so wait up to 5 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});
