# Phase 0 — Feature Traceability Matrix
## Purpose

Track every project feature from its intended user experience through backend capability, API availability, security requirements, and verification. Missing API routes must be recorded as gaps, not treated as permission to omit a feature.

## Status Definitions

- NOT STARTED — No implementation or verification work recorded.
- IN PROGRESS — Work has begun but is incomplete.
- BLOCKED — A dependency, security issue, or missing contract prevents completion.
- IMPLEMENTED — Implementation exists; required verification is still pending.
- VERIFIED — Evidence confirms the stated acceptance criteria.
- DEFERRED — Explicitly approved for later delivery; record the decision and rationale.

## Traceability Rules

- Preserve the complete project scope and roadmap.
- Link each feature to relevant endpoint operations where applicable.
- Record internal backend capabilities even when no API route exposes them.
- Record missing endpoints, unclear contracts, and security gaps explicitly.
- Do not mark a feature VERIFIED solely because its OpenAPI operation exists.
- Distinguish confirmed observations from unresolved questions.
- Keep the existing endpoint-to-page matrix unchanged.

## Feature Inventory

| ID | Feature Area | Backend / API Evidence | Frontend Coverage Required | Initial Status |
|---|---|---|---|---|
| F-01 | Authentication and Registration | Auth routes; bearer-token authentication | Registration, login, session handling, logout behavior | IN PROGRESS |
| F-02 | User Profile and Settings | User routes | Profile viewing, account settings, supported edits | NOT STARTED |
| F-03 | Broker Connections | Broker routes and account services | Connection setup, account listing, status, errors | NOT STARTED |
| F-04 | Strategy Management | Strategy routes and StrategyRegistry | Browse, inspect, configure, validate strategies | IN PROGRESS |
| F-05 | Instrument Catalogue | Instrument routes and market-data modules | Search, inspect, select instruments | IN PROGRESS |
| F-06 | Market Data | Market-data providers, loaders, pipeline, cache; no registered market-data router | Data availability, freshness, source and error states | BLOCKED |
| F-07 | Backtest Configuration | POST /backtests; CreateBacktestRequest | Strategy, instrument, dates, timeframe, capital, quantity and execution configuration | IN PROGRESS |
| F-08 | Backtest Execution Lifecycle | Execution routes; asynchronous backtest execution | Submission, polling, progress, failure and cancellation states | BLOCKED |
| F-09 | Backtest Results and Artifacts | Canonical results and filesystem artifact manager; retrieval API not identified | Metrics, equity curve, trades, provenance and reproducibility | BLOCKED |
| F-10 | Execution History | Execution routes; access-control gaps recorded separately | History, detail, status and ownership-safe access | BLOCKED |
| F-11 | Orders | Order routes and trading records | Order listing, details, supported actions and errors | BLOCKED |
| F-12 | Trades | Trade routes and backtest fill/trade services | Trade history, details and filtering | BLOCKED |
| F-13 | Positions | Position routes and portfolio/trading services | Position details, quantities, valuation and risk where supported | BLOCKED |
| F-14 | Portfolio | Portfolio routes, allocation, state, persistence and risk modules | Holdings, allocations, performance and simulation disclosure | IN PROGRESS |
| F-15 | Notifications | Notification routes | Notification list, read state and delivery/error behavior | BLOCKED |
| F-16 | Dashboard | No dedicated aggregation endpoint identified | Summary, recent activity and verified portfolio/execution metrics | BLOCKED |
| F-17 | Walk-Forward Analysis | Internal walk-forward analyzer; API contract not identified | Configuration, results and validation summaries | BLOCKED |
| F-18 | Stress Testing and Monte Carlo | Internal regime/stress and Monte Carlo modules; API contract not identified | Scenarios, distributions, risk summaries and limitations | BLOCKED |
| F-19 | Regime Detection | ML dataset, features, model, persistence and service modules; API contract not identified | Regime output, confidence/context where available, model status | BLOCKED |
| F-20 | Strategy Scoring and Factors | ML factors and scoring modules; API contract not identified | Scores, factor breakdown and validation context | BLOCKED |
| F-21 | Quantitative Indicators and Statistics | Indicator and statistical utility modules | Surface only where needed by approved workflows and supported by contracts | NOT STARTED |
| F-22 | System Health and Landing | Root route; health router has no registered route definitions | Landing page, service status where supported, safe error states | IN PROGRESS |
| F-23 | Paper Trading | Previously tracked as Phase 13; delivery explicitly postponed pending roadmap decision | Preserve in project scope; confirm sequencing and required API contracts | BLOCKED |
| F-24 | Live Trading | No confirmed operational live-trading flow in current evidence | Track requirements and safety gates; do not imply availability | BLOCKED |

> Initial statuses are planning assessments, not completion claims. Confirm each feature against the approved roadmap, source code, API contracts, and acceptance tests before finalizing its status.
## Feature-to-Endpoint Mapping

Use `endpoint_to_page_matrix.md` as the source of truth for the 65 OpenAPI operations. Each feature below must be connected to its relevant operations by HTTP method and path.

| Feature ID | Endpoint Family | Mapping Status | Notes |
|---|---|---|---|
| F-01 | `/auth/*` | TO REVIEW | Register, login and other authentication operations |
| F-02 | `/users/*` | TO REVIEW | Profile and account operations |
| F-03 | `/brokers/*` | TO REVIEW | Broker and broker-account operations |
| F-04 | `/strategies/*` | TO REVIEW | Strategy operations |
| F-05 | `/instruments/*` | TO REVIEW | Instrument catalogue operations |
| F-06 | No registered market-data router identified | API GAP TO REVIEW | Identify the intended market-data access contract |
| F-07 | `POST /backtests` | TO REVIEW | Backtest submission and request configuration |
| F-08 | `/executions/*`, `/backtests/*` | TO REVIEW | Confirm lifecycle and status operations |
| F-09 | No result/artifact retrieval route identified | API GAP TO REVIEW | Define retrieval contract for persisted backtest artifacts |
| F-10 | `/executions/*` | TO REVIEW | Confirm history, detail, authentication and ownership |
| F-11 | `/orders/*` | TO REVIEW | Confirm operations and access-control requirements |
| F-12 | `/trades/*` | TO REVIEW | Confirm operations and access-control requirements |
| F-13 | `/positions/*` | TO REVIEW | Confirm operations and access-control requirements |
| F-14 | `/portfolio/*` | TO REVIEW | Confirm simulation scope and response contracts |
| F-15 | `/notifications/*` | TO REVIEW | Confirm identity, ownership and read-state contracts |
| F-16 | No dedicated dashboard route identified | API GAP TO REVIEW | Define aggregation or supported composition strategy |
| F-17 | No walk-forward API contract identified | API GAP TO REVIEW | Decide how the internal analyzer is exposed |
| F-18 | No stress-testing/Monte Carlo API contract identified | API GAP TO REVIEW | Define supported configuration and result contracts |
| F-19 | No regime-detection API contract identified | API GAP TO REVIEW | Define service access and response contract |
| F-20 | No strategy-scoring API contract identified | API GAP TO REVIEW | Define scoring access and response contract |
| F-21 | No dedicated quantitative analytics contract identified | API GAP TO REVIEW | Map utilities to approved user workflows |
| F-22 | `GET /` | TO REVIEW | Confirm landing and health/status requirements |
| F-23 | No confirmed paper-trading API contract | ROADMAP/API REVIEW | Preserve scope and confirm sequencing |
| F-24 | No confirmed operational live-trading flow | ROADMAP/API REVIEW | Establish requirements and safety gates |

> This is a preliminary family-level mapping. It does not replace operation-by-operation traceability or confirm that any endpoint is safe or fully functional.

## Security Traceability

Source: `security_gap_register.md`. Finding status and acceptance criteria remain governed by that register.

| Feature ID | Security Gap | Required Gate | Traceability Status |
|---|---|---|---|
| F-05 | SEC-005 | Confirm instrument catalogue read/write access policy and enforce the approved policy | OPEN |
| F-08 | SEC-001 | Authenticate execution access and enforce authorization | OPEN |
| F-09 | SEC-001 | Protect result/artifact access through verified execution ownership or authorization | OPEN |
| F-10 | SEC-001 | Authenticate execution history and detail access; enforce ownership | OPEN |
| F-11 | SEC-002 | Authenticate order access and prevent cross-user access | OPEN |
| F-12 | SEC-003 | Authenticate trade access and prevent cross-user access | OPEN |
| F-13 | SEC-004 | Authenticate position access and prevent cross-user access | OPEN |
| F-15 | SEC-006 | Resolve notification identity and ownership; verify behavior with authenticated tests | OPEN |

> These are traceability links, not claims that every associated vulnerability has been fully proven. SEC-006 remains inconclusive until its identity and access policy are verified. Do not close a gate without recorded evidence and acceptance tests.

## Backend Capability and API-Gap Traceability

Source references: `phase0_decisions_and_gaps.md`, `phase0_requirements_review.md`, and the backend modules inspected during Phase 0. These entries require contract decisions and verification before being treated as resolved.

| Gap ID | Feature IDs | Capability or Missing Contract | Required Follow-up | Status |
|---|---|---|---|---|
| API-01 | F-09 | Backtest results and artifacts have internal/filesystem representations; retrieval API not identified | Define authenticated retrieval contract for metrics, equity curve, trades and provenance | OPEN |
| API-02 | F-17 | Walk-forward analysis exists internally; API contract not identified | Define request, execution, results and validation contract | OPEN |
| API-03 | F-18 | Stress testing and Monte Carlo modules exist internally; API contract not identified | Define scenario inputs, execution behavior and result schemas | OPEN |
| API-04 | F-19 | Regime detection service/model modules exist internally; API contract not identified | Define invocation, model availability and prediction response contract | OPEN |
| API-05 | F-20 | Strategy factors and scoring modules exist internally; API contract not identified | Define scoring inputs, output schema and validation context | OPEN |
| API-06 | F-06 | No registered market-data router identified in current inspection | Confirm data-provider access, supported instruments/timeframes, freshness and errors | OPEN |
| API-07 | F-16 | No dedicated dashboard aggregation endpoint identified | Decide between a dedicated endpoint and safe composition of existing contracts | OPEN |
| API-08 | F-01 | No logout endpoint identified in the current API inventory | Define client token clearing and whether server-side revocation is required | OPEN |
| API-09 | F-21 | Quantitative indicators/statistics are internal utilities; frontend-facing contract not identified | Map required analytics to approved workflows and define contracts where needed | OPEN |
| API-10 | F-23 | Paper-trading API contract and sequencing require confirmation | Preserve the feature in project scope and confirm roadmap order and prerequisites | OPEN |
| API-11 | F-24 | No confirmed operational live-trading flow in current evidence | Define scope, broker integration, authorization and safety gates before implementation | OPEN |

> These are traceability IDs for the frontend Phase 0 document, not replacements for existing backend issue IDs. “OPEN” means the gap requires follow-up; it does not assert that every internal capability is production-ready.

## Verification and Acceptance Requirements

A feature must not be marked VERIFIED until its applicable checks below have recorded evidence.

| Check ID | Verification Requirement | Required Evidence |
|---|---|---|
| V-01 | Scope and user journey | Approved roadmap and user-flow specification reference |
| V-02 | Endpoint traceability | Relevant HTTP method, path and operation ID from the endpoint matrix, or a documented API gap |
| V-03 | Request and response contracts | Valid request, successful response, validation failure and relevant error behavior |
| V-04 | Authentication and authorization | Missing/invalid credentials rejected where required; ownership and cross-user access tests |
| V-05 | Functional behavior | Tests or reproducible results for the feature's supported workflows |
| V-06 | Failure states | Loading, empty, validation, network, server-error and asynchronous failure behavior where applicable |
| V-07 | Data integrity | Correct persistence, isolation and consistency for the applicable workflow |
| V-08 | Regression safety | Relevant automated tests pass without unexplained regressions |
| V-09 | Frontend integration | Feature works against the actual backend contract, not only mocked data |
| V-10 | Evidence recording | Test command, outcome, date/context and linked report or test reference are recorded |

## Feature Completion Rule

- IMPLEMENTED means implementation exists; it does not imply integration or security verification.
- VERIFIED requires applicable acceptance checks to pass with recorded evidence.
- BLOCKED requires a documented dependency, unresolved contract, or security issue.
- DEFERRED requires an explicit roadmap decision and rationale.
- A missing backend contract must remain OPEN/BLOCKED until implemented or explicitly dispositioned through an approved project decision.
- Do not mark the whole project Phase 0 complete while required feature areas, security gates, or roadmap decisions remain unresolved.

## Current Verification Baseline

| Area | Existing Evidence | What It Proves | What It Does Not Prove |
|---|---|---|---|
| Backend regression suite | Previously recorded result: 907 passed | The recorded backend test suite passed at that point | Current test status after later changes or frontend integration |
| OpenAPI contract inventory | `api_contract_verification.md` | 65 saved operations matched 65 live OpenAPI operations in the recorded check | Runtime correctness, authorization, or complete feature coverage |
| Runtime smoke checks | `api_runtime_verification.md` | Six recorded smoke checks passed | All endpoint behaviors or authenticated workflows |
| Unauthenticated GET audit | `unauthenticated_access_audit.md` | 20 GET requests were examined and their observed responses recorded | Full penetration testing or proof of sensitive-data disclosure |
| Security gap register | `security_gap_register.md` | Six findings are documented for follow-up | Security remediation is complete |
| Endpoint-to-page matrix | `endpoint_to_page_matrix.md` | 65 OpenAPI operations have preliminary page mappings | Every operation has been verified against the approved UX |
| Feature traceability matrix | This document | Feature inventory, preliminary API mapping, security references and API gaps are recorded | All features are implemented, integrated or verified |

> Historical test results must be rerun when required by the release process. Do not present a previously passing test suite as a current result without rerunning it.

