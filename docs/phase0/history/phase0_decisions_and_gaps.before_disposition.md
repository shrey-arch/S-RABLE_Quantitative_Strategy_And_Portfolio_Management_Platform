# Phase 0 — Decisions and Backend Gaps

Status vocabulary: CONFIRMED, CONFIRM IN PHASE 0, BLOCKED, DEFERRED.

## Confirmed from inspected code and OpenAPI

| Item | Status | Evidence / consequence |
|---|---|---|
| Authentication mechanism | CONFIRMED | Login returns a bearer access token; protected routes use HTTPBearer and get_current_user. |
| Strategy ownership | CONFIRMED | Strategy operations scope records to the authenticated user. |
| Broker-account ownership | CONFIRMED | Broker-account operations scope records to the authenticated user. |
| Execution states | CONFIRMED | PENDING, RUNNING, COMPLETED, FAILED, CANCELLED. |
| Backtest submission | CONFIRMED | POST /backtests creates an asynchronous execution; frontend must track its state. |
| Portfolio operations | CONFIRMED | Responses identify simulation-only behavior; do not represent them as live execution. |
| Instrument catalogue | CONFIRMED | Instrument records are shared; no user_id field exists. Write-operation authorization policy remains unresolved. |

## Confirmed blockers or security gaps from inspected code

| ID | Area | Status | Finding | Required resolution |
|---|---|---|---|---|
| SEC-01 | Executions/backtests | BLOCKED | Execution routes lack authenticated-user dependency and ownership filtering. | Define ownership model, enforce authorization, add cross-user tests. |
| SEC-02 | Orders | BLOCKED | Routes lack authentication; repository list/get queries are global or ID-only. | Enforce authentication and ownership through linked records; add tests. |
| SEC-03 | Trades | BLOCKED | Routes lack authentication; repository list/get queries are global or ID-only. | Enforce authorization through order/execution ownership; add tests. |
| SEC-04 | Positions | BLOCKED | Routes lack authentication; repository list/get queries are global or ID-only. | Enforce authorization through execution/broker ownership; add tests. |
| SEC-05 | Notifications | BLOCKED | Routes accept caller-supplied user_id instead of deriving identity from the bearer token. | Require authentication and derive user identity server-side. |
| API-01 | Analytics/results | BLOCKED | Dedicated result/artifact retrieval contract was not found in registered API routes. | Decide and expose the required result retrieval API, or document the supported metrics-only scope. |
| API-02 | Validation | BLOCKED | No dedicated walk-forward, stress-test, or Monte Carlo API routes found in the OpenAPI inventory. | Decide which capabilities are exposed in this release. |
| API-03 | Regime/scoring | BLOCKED | Internal modules exist, but dedicated regime detection and strategy scoring endpoints were not found. | Define API contracts or defer these frontend features. |
| API-04 | Market data | CONFIRM IN PHASE 0 | No dedicated market-data read endpoint appeared in the 65-operation inventory. | Confirm intended data source and supported frontend data flow. |
| API-05 | Dashboard | CONFIRM IN PHASE 0 | No dedicated dashboard-summary endpoint appeared in the inventory. | Decide whether dashboard uses existing endpoints or needs aggregation API. |
| API-06 | Session lifecycle | CONFIRM IN PHASE 0 | No logout endpoint appeared in the inventory. | Frontend must clear local token; decide whether server-side revocation is required. |
| DATA-01 | Demo data | CONFIRM IN PHASE 0 | No seed/fixture script was found in the searched backend paths. | Create deterministic seed tooling and verify it against a clean database. |

## Remaining UX decisions

These decisions must be resolved against the approved roadmap and actual code before the frontend-readiness gate is passed:

1. Registration, password recovery, and profile editing support.
2. Exact strategy and instrument fields and CRUD behavior.
3. Broker configuration and connection-test capabilities.
4. Backtest status polling, metrics, and result format.
5. Execution history behavior.
6. Portfolio data source and simulation-only boundaries.
7. Supported order actions.
8. Notification read state and delivery behavior.
9. Market-data source and availability.
10. Dashboard aggregation strategy.
11. Final navigation labels and hierarchy.
12. Production static-file serving and SPA route fallback.
13. Authorization and ownership gaps affecting user journeys.
14. Final disposition of every roadmap item marked CONFIRM IN PHASE 0.

## Rules

- A missing dedicated endpoint is not proof that an internal implementation is absent.
- Do not expose a blocked data operation as usable until backend authorization is verified.
- Do not claim a feature works based solely on route registration or schema generation.
- Keep the original backend Phase 0 baseline distinct from this frontend-readiness audit.
- Update this register when a finding is tested, fixed, deferred, or superseded.
