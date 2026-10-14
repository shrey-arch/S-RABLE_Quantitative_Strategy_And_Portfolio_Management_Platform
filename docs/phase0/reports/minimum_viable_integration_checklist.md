# Frontend Integration Readiness Checklist

Purpose: Identify the minimum work needed to integrate the frontend with
the existing S-RABLE backend. This is a project-completion checklist, not
a production-grade security audit.

## 1. Authentication and profile

- [x] Login and registration routes exist.
- [x] Profile read/update routes exist.
- [x] Missing login and registration fields return HTTP 422.
- [x] Protected profile access rejects unauthenticated requests.
- [ ] Verify successful login and registration using an isolated test database.
- [ ] Verify frontend token storage, expiry handling, and redirect behavior.
- [ ] Confirm whether password recovery is required for the initial release.

Classification: READY FOR FRONTEND WORK; END-TO-END VERIFICATION REQUIRED.

## 2. Strategies

- [x] Strategy collection and detail routes exist.
- [x] Existing API tests cover authentication and strategy behavior.
- [x] Unauthenticated strategy reads return HTTP 401.
- [ ] Verify create, edit, delete, and empty/error states through the API.
- [ ] Connect frontend forms to the actual request and response schemas.

Classification: READY FOR FRONTEND WORK; VERIFY INTEGRATION.

## 3. Broker connections

- [x] Broker account CRUD and connect/disconnect routes exist.
- [x] Unauthenticated broker account reads return HTTP 401.
- [ ] Verify connection lifecycle and error responses.
- [ ] Confirm which broker connection modes work in the current environment.

Classification: READY FOR FRONTEND WORK; LIVE CONNECTIVITY NOT YET CONFIRMED.

## 4. Instrument catalogue

- [x] Instrument collection and detail routes exist.
- [x] Unauthenticated catalogue reads currently return HTTP 200.
- [ ] Confirm whether public reads are intended.
- [ ] Verify write authorization and catalogue validation.
- [ ] Decide how the frontend handles an empty catalogue or unavailable data.

Classification: READ FLOW CONDITIONALLY READY; WRITE POLICY UNRESOLVED.

## 5. Backtesting and execution lifecycle

- [x] Backtest submission route exists.
- [x] Execution list/detail and lifecycle routes exist.
- [x] Execution states include PENDING, RUNNING, COMPLETED, FAILED, CANCELLED.
- [ ] Verify backtest submission and asynchronous status progression.
- [ ] Verify how completed results and artifacts can be retrieved.
- [ ] Decide how the frontend presents unavailable or failed results.
- [ ] Resolve execution authentication/ownership only to the extent required
      for intended user-specific functionality.

Classification: NEEDS INTEGRATION VERIFICATION; RESULTS RETRIEVAL MAY BLOCK
DETAILED BACKTEST RESULT SCREENS.

## 6. Orders, trades, and positions

- [x] CRUD and lifecycle routes exist in the OpenAPI contract.
- [x] Unauthenticated collection requests returned HTTP 200 in local checks.
- [ ] Decide whether these features are needed in the initial demonstration.
- [ ] If included, verify that records are associated with the correct
      execution/account and user.
- [ ] Test intended workflows without using the real development data.

Classification: NEEDS SCOPE DECISION AND TARGETED VERIFICATION.

## 7. Portfolio

- [x] Portfolio account and state/target/rebalance routes exist.
- [x] Unauthenticated portfolio account reads return HTTP 401.
- [x] Existing backend review identifies portfolio functionality as simulation-only.
- [ ] Verify portfolio creation, state retrieval, and rebalance behavior.
- [ ] Label simulated values accurately in the frontend.

Classification: READY FOR SIMULATION-ONLY UI WORK; API VERIFICATION REQUIRED.

## 8. Notifications

- [x] Notification routes exist.
- [x] Notification reads require a user_id parameter.
- [ ] Verify intended frontend behavior and notification lifecycle.
- [ ] Confirm that notifications are associated with the correct user.
- [ ] Test empty, unread, read, and error states.

Classification: NEEDS TARGETED VERIFICATION.

## 9. Dashboard and market data

- [x] Root endpoint responds successfully.
- [ ] Confirm the data sources available for dashboard cards.
- [ ] Confirm market-data provider availability and actual frontend-facing API.
- [ ] Build dashboard cards only from verified data.
- [ ] Show clear empty/unavailable states when data is unsupported.

Classification: NEEDS DATA-SOURCE CONFIRMATION.

## 10. Explicitly deferred or unsupported until confirmed

- [x] Paper Trading remains deferred.
- [x] No dedicated market-data read route was found in the 65-operation inventory.
- [x] No dedicated backtest-artifact retrieval route was identified.
- [x] No dedicated walk-forward, stress-test, Monte Carlo, regime-detection,
      or strategy-scoring API route was identified.
- [ ] Do not present these as working frontend features without a verified path.

Classification: DEFERRED; DO NOT EXPAND INITIAL SCOPE.

## 11. Final integration gate

- [ ] Confirm the initial feature scope against the user-flow specification.
- [ ] Complete request/response examples for required frontend workflows.
- [ ] Verify required routes using non-destructive tests or an isolated database.
- [ ] Verify each included feature's success, empty, loading, and error states.
- [ ] Resolve blockers or explicitly defer affected features.
- [ ] Run backend regression tests after any approved backend changes.
- [ ] Confirm the frontend can run against the documented backend configuration.

## Working rules

1. Do not modify backend code without explicit approval.
2. Prefer finishing existing features over adding new architecture.
3. Do not claim an endpoint or feature is verified merely because a route exists.
4. Defer optional features instead of allowing them to delay the project.
5. Preserve existing working behavior and run regression tests after approved changes.
