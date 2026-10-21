import type { components } from './schema';

/**
 * Portfolio responses, as typed by openapi.json (app/schemas/portfolio/responses.py).
 * Money values are decimal strings, e.g. "100000.00". Everything is simulated.
 */

/** One item of GET /portfolio/accounts. */
export type PortfolioListItem = components['schemas']['PortfolioSummary'];

/** GET /portfolio/accounts/{portfolio_id} */
export type PortfolioState = components['schemas']['PortfolioAccount'];
