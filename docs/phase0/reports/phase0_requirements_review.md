# Phase 0 — Requirements and Decisions Review

Source: `docs/user_flow_specification.md`.
Extracted sections are reproduced for review; they are not assumed resolved.

## 4. Product scope and capability map

## 4. Product scope and capability map

The previous backend audit identified registered routers for:

- Authentication and users
- Brokers
- Strategies
- Instruments
- Executions
- Backtesting
- Orders
- Trades
- Positions
- Portfolio
- Notifications

The audit also reported that the market-data router was empty or not registered, and AI, health, and trading modules were empty or not registered at that time. Re-check the current repository before relying on those findings.

| Product area | UX treatment |
|---|---|
| Authentication and users | Core entry flow; verify exact supported operations |
| Strategies, instruments, and brokers | Resource-management journeys; verify schemas, actions, and permissions |
| Backtesting and executions | Core workflow: submit, track, and inspect results |
| Portfolio | Display only supported information; the previous audit described behavior as simulation-only, which must be re-verified |
| Orders, trades, and positions | Display supported records; do not imply live execution |
| Notifications | Show supported notifications and available actions |
| Market data | Pending confirmation of a real data source and API |
| AI capabilities | Not part of the initial flow until implemented and verified |
| Paper Trading (Phase 13) | Explicitly deferred |
| Live trading | Do not expose as operational without verified backend support and approved safeguards |

A registered router is not proof that a complete end-to-end feature exists.

---


---

## 23. Open decisions required before calling the UX flow final


## 23. Open decisions required before calling the UX flow final

The following items must be verified or decided:

1. Exact authentication flow and session mechanism.
2. Whether registration, password recovery, and profile editing are supported.
3. Exact strategy and instrument CRUD operations and fields.
4. Broker configuration and connection-test capabilities.
5. Backtest request/response schema, statuses, result format, and polling rules.
6. Execution listing and history capabilities.
7. Portfolio data source and simulation-only boundaries.
8. Which order actions, if any, are actually supported.
9. Notification read state and delivery behavior.
10. Availability and source of market data.
11. Whether the dashboard has dedicated summary endpoints.
12. The final navigation labels and visual hierarchy.
13. Production static-file serving and client-side route fallback behavior.
14. Any confirmed backend authorization/ownership gaps affecting user journeys.

Resolve these through repository/API inspection and product decisions. Do not fill gaps by assumption.

---

## 24. Change-management rules

When a product or API change alters a user journey:

1. Update this document in the same change set as the relevant implementation, or explicitly link the follow-up issue.
2. State which journey changed and why.
3. Update the corresponding acceptance criteria and tests.
4. Mark a previously supported capability as unavailable if it stops working.
5. Keep the document aligned with the actual application rather than preserving obsolete flows.

Suggested owner: the person coordinating frontend integration. All three team members should flag inconsistencies between this specification and implementation.

---


---

## 22. Acceptance criteria for a complete user journey


## 22. Acceptance criteria for a complete user journey

A feature is not complete just because the page renders.

For each journey, verify:

- [ ] The user can reach the page through the agreed navigation.
- [ ] Direct URL access and refresh behave correctly.
- [ ] The page uses the verified API contract.
- [ ] Loading, empty, success, validation, error, and permission states are implemented where applicable.
- [ ] Duplicate or unsafe actions are handled appropriately.
- [ ] Authentication and ownership rules are enforced by the backend.
- [ ] No mock data is presented as real data.
- [ ] The flow is keyboard accessible and responsive.
- [ ] Component/unit tests cover important behavior.
- [ ] Critical end-to-end flows are tested in a browser.
- [ ] The implementation and any deviations are reflected in this document.

---


---

## 19. Authentication, authorization, and ownership are release gates


## 19. Authentication, authorization, and ownership are release gates

The previous backend audit identified some CRUD routes that may lack route-level authenticated ownership controls. This is a finding to investigate, not proof that every such route is exploitable.

Before exposing a data operation in the frontend:

1. Verify authentication requirements.
2. Verify the backend checks authorization and record ownership.
3. Verify users cannot read, edit, or delete another user's resources by changing an ID.
4. Verify errors do not disclose another user's data.
5. Test the API directly; hiding a button or route in the frontend is not a security control.
6. Resolve and test any confirmed security issue before release.

The frontend must not be considered secure merely because its routes are protected.

---

## 20. Accessibility, responsiveness, and usability

Every implemented flow should follow these baseline rules:

- All primary actions are keyboard accessible.
- Forms have labels, understandable validation messages, and visible focus.
- Status changes are conveyed in accessible ways.
- Color is not the only way to distinguish success, failure, or status.
- Tables remain usable at narrower widths or have an intentional responsive alternative.
- Dialogs manage focus and can be closed according to accessible interaction patterns.
- Loading states do not cause avoidable layout shifts.
- Dates, times, quantities, percentages, and currencies have consistent formatting.
- Test keyboard navigation and responsive layouts for each complete journey.

---


---
