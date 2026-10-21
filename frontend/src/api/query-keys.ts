/**
 * Query keys - one place that names every cached piece of server data.
 *
 * Keys are hierarchical, so one call refreshes a whole area:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.strategies.all })
 * refreshes the strategy list AND every strategy detail.
 *
 * Convention: after a successful create / update / delete, invalidate the
 * `.all` key of every area the change affects.
 *
 * Only areas that have a confirmed, usable API (Phase 0) are listed.
 */
export const queryKeys = {
  me: ['me'] as const,

  strategies: {
    all: ['strategies'] as const,
    list: () => ['strategies', 'list'] as const,
    detail: (id: string) => ['strategies', 'detail', id] as const,
  },

  /** Built-in strategies from GET /strategy-registry (read-only). */
  registry: {
    all: ['registry'] as const,
    list: () => ['registry', 'list'] as const,
  },

  /** Indicator catalogue from GET /indicators (read-only). */
  indicators: {
    all: ['indicators'] as const,
    list: () => ['indicators', 'list'] as const,
  },

  instruments: {
    all: ['instruments'] as const,
    list: (filters: { activeOnly?: boolean } = {}) => ['instruments', 'list', filters] as const,
    detail: (id: string) => ['instruments', 'detail', id] as const,
    marketData: (id: string, range: { start?: string; end?: string } = {}) =>
      ['instruments', 'market-data', id, range] as const,
    coverage: (id: string, range: { start?: string; end?: string } = {}) =>
      ['instruments', 'coverage', id, range] as const,
    /** An indicator series computed by the backend on the instrument's bars. */
    indicator: (id: string, overlay: string, range: { start?: string; end?: string } = {}) =>
      ['instruments', 'indicator', id, overlay, range] as const,
  },

  /** Backtest runs (GET /executions, /executions/{id}), always the current user's. */
  executions: {
    all: ['executions'] as const,
    list: (filters: Record<string, string> = {}) => ['executions', 'list', filters] as const,
    detail: (id: string) => ['executions', 'detail', id] as const,
    /** GET /executions/{id}/results: fixed once the run has completed. */
    results: (id: string) => ['executions', 'results', id] as const,
  },

  /** Validation runs (GET /validations, /validations/{id}), always the current user's. */
  validations: {
    all: ['validations'] as const,
    list: (filters: Record<string, string> = {}) => ['validations', 'list', filters] as const,
    detail: (id: string) => ['validations', 'detail', id] as const,
  },

  /** Portfolio backtests against Nifty 50 (GET /portfolio-backtests/...), the user's own. */
  portfolioBacktests: {
    all: ['portfolio-backtests'] as const,
    list: () => ['portfolio-backtests', 'list'] as const,
    detail: (id: string) => ['portfolio-backtests', 'detail', id] as const,
    /** GET /portfolio-backtests/{id}/results: fixed once the run has completed. */
    results: (id: string) => ['portfolio-backtests', 'results', id] as const,
  },

  /** Market-regime models (GET /regime/...); one model is shared by everyone. */
  regime: {
    all: ['regime'] as const,
    models: () => ['regime', 'models'] as const,
    model: (id: string) => ['regime', 'model', id] as const,
    current: () => ['regime', 'current'] as const,
    history: (range: { start?: string; end?: string } = {}) =>
      ['regime', 'history', range] as const,
  },

  /** Strategy scores (POST /scoring is a read: weights travel in the body). */
  scoring: {
    all: ['scoring'] as const,
    definitions: () => ['scoring', 'definitions'] as const,
    scores: (weights: Record<string, Record<string, number>> | null = null) =>
      ['scoring', 'scores', weights] as const,
    regimeFit: () => ['scoring', 'regime-fit'] as const,
  },

  /** The user's notifications (GET /notifications, /notifications/unread-count). */
  notifications: {
    all: ['notifications'] as const,
    list: (filters: object = {}) => ['notifications', 'list', filters] as const,
    unread: () => ['notifications', 'unread'] as const,
  },

  brokers: {
    all: ['brokers'] as const,
    list: () => ['brokers', 'list'] as const,
    detail: (id: string) => ['brokers', 'detail', id] as const,
  },

  /** Trading records (GET /orders, /trades, /positions), always the current user's. */
  records: {
    all: ['records'] as const,
    list: (kind: string, filters: Record<string, string> = {}) =>
      ['records', kind, 'list', filters] as const,
    detail: (kind: string, id: string) => ['records', kind, 'detail', id] as const,
    counts: (executionId: string) => ['records', 'counts', executionId] as const,
  },

  /** The user's paper trading account (GET /paper/...). */
  paper: {
    all: ['paper'] as const,
    account: () => ['paper', 'account'] as const,
    quotes: (ids: string[]) => ['paper', 'quotes', ids] as const,
    orders: () => ['paper', 'orders'] as const,
    holdings: () => ['paper', 'holdings'] as const,
    fills: () => ['paper', 'fills'] as const,
    charges: () => ['paper', 'charges'] as const,
    preview: (body: object) => ['paper', 'preview', body] as const,
    deployments: () => ['paper', 'deployments'] as const,
    deployment: (id: string) => ['paper', 'deployment', id] as const,
    performance: () => ['paper', 'performance'] as const,
  },

  /** Feature 6: the custom Python sandbox (GET /sandbox/reference). */
  sandbox: {
    all: ['sandbox'] as const,
    reference: () => ['sandbox', 'reference'] as const,
  },

  /** Feature 7: live paper sessions (GET /live/...), always the current user's. */
  live: {
    all: ['live'] as const,
    sessions: () => ['live', 'sessions'] as const,
    detail: (id: string) => ['live', 'detail', id] as const,
    bars: (id: string) => ['live', 'bars', id] as const,
    events: (id: string) => ['live', 'events', id] as const,
    fills: (id: string) => ['live', 'fills', id] as const,
    replayDays: (instrumentId: string) => ['live', 'replay-days', instrumentId] as const,
    status: () => ['live', 'status'] as const,
  },

  portfolios: {
    all: ['portfolios'] as const,
    list: () => ['portfolios', 'list'] as const,
    detail: (id: string) => ['portfolios', 'detail', id] as const,
    prices: (assets: string[]) => ['portfolios', 'prices', assets] as const,
  },
};
