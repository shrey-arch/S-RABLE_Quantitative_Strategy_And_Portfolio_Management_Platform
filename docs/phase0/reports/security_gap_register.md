# Backend Security Gap Register

Generated from the local unauthenticated GET audit.
Evidence report: `frontend/unauthenticated_access_audit.md`

## Status definitions

- CONFIRMED OBSERVATION: directly observed in a recorded request.
- REMEDIATION REQUIRED: expected security policy is not met by current evidence.
- POLICY DECISION REQUIRED: product owner must confirm intended access.
- NOT VERIFIED: evidence is insufficient to reach a conclusion.

A successful unauthenticated response is a security finding to investigate.
It is not, by itself, proof that sensitive records were disclosed.

---

## SEC-001 — Execution collection lacks demonstrated authentication

- **Priority:** P0 — security blocker pending triage
- **Status:** CONFIRMED OBSERVATION; REMEDIATION REQUIRED
- **Evidence:** `GET /executions` returned HTTP 200 without credentials.
- **Risk:** Execution history or configuration may be accessible without a
  verified identity. The current execution model/repository audit also
  indicates that user ownership is not represented.
- **Required remediation:**
  1. Require authenticated identity for execution collection and detail routes.
  2. Associate executions with an owner or an explicitly authorized parent.
  3. Enforce ownership/authorization in service and repository access.
  4. Return 401 for missing/invalid credentials and prevent cross-user access.
- **Acceptance criteria:**
  - No-token request is rejected.
  - User A cannot list or retrieve User B's execution.
  - Authorized owner can access their own permitted execution.
  - Automated tests cover these cases.

## SEC-002 — Orders collection lacks demonstrated authentication

- **Priority:** P0 — security blocker pending triage
- **Status:** CONFIRMED OBSERVATION; REMEDIATION REQUIRED
- **Evidence:** `GET /orders` returned HTTP 200 without credentials.
- **Risk:** Order information may be exposed. Order routes and records were
  previously identified as lacking user-scoped authorization.
- **Required remediation:**
  1. Require authenticated identity for all order routes.
  2. Enforce access through the owning execution/account or explicit owner.
  3. Apply the same policy to collection, detail, and state-changing routes.
- **Acceptance criteria:**
  - Missing/invalid credentials are rejected.
  - Cross-user order access is denied.
  - Owner-scoped success and failure cases are tested.
  - Mutation routes cannot bypass the same authorization policy.

## SEC-003 — Trades collection lacks demonstrated authentication

- **Priority:** P0 — security blocker pending triage
- **Status:** CONFIRMED OBSERVATION; REMEDIATION REQUIRED
- **Evidence:** `GET /trades` returned HTTP 200 without credentials.
- **Risk:** Trade records and transaction-related data may be exposed.
- **Required remediation:**
  1. Require authenticated identity for all trade routes.
  2. Enforce ownership/authorization through the relevant order, execution,
     or account relationship.
  3. Apply authorization to trade execution and all write operations.
- **Acceptance criteria:**
  - Missing/invalid credentials are rejected.
  - Cross-user trade access is denied.
  - Authenticated owner access and unauthorized access are tested.
  - Trade execution cannot operate without appropriate authorization.

## SEC-004 — Positions collection lacks demonstrated authentication

- **Priority:** P0 — security blocker pending triage
- **Status:** CONFIRMED OBSERVATION; REMEDIATION REQUIRED
- **Evidence:** `GET /positions` returned HTTP 200 without credentials.
- **Risk:** Position sizes, valuations, and profit/loss information may be
  exposed. Position records were previously identified as lacking user scope.
- **Required remediation:**
  1. Require authenticated identity for all position routes.
  2. Enforce authorization through an owning account/execution or explicit
     owner relationship.
  3. Protect detail, create, update, and delete operations consistently.
- **Acceptance criteria:**
  - Missing/invalid credentials are rejected.
  - Cross-user position access is denied.
  - Owner-scoped tests cover reads and writes.

## SEC-005 — Instrument catalogue access policy needs confirmation

- **Priority:** P1 — policy decision required
- **Status:** POLICY DECISION REQUIRED
- **Evidence:** `GET /instruments` returned HTTP 200 without credentials.
- **Decision required:** Confirm whether instrument catalogue reads are public.
- **Required remediation/review:**
  1. Document the intended read-access policy.
  2. Decide who may create, update, or delete shared catalogue entries.
  3. Require appropriate authorization for writes unless explicitly approved.
- **Acceptance criteria:**
  - Read and write policies are documented.
  - Tests enforce each policy.
  - Unapproved callers cannot alter the shared catalogue.

## SEC-006 — Notification access behavior remains inconclusive

- **Priority:** P1 — investigation required
- **Status:** NOT VERIFIED
- **Evidence:** `GET /notifications` and a detail request returned HTTP 422
  without credentials. Required request parameters may be missing.
- **Risk:** Existing code review identified caller-supplied user identity as a
  potential impersonation risk.
- **Required remediation:**
  1. Repeat tests with valid query parameters but no credentials.
  2. Derive the user identity from the authenticated principal, not from an
     untrusted caller-supplied identifier.
  3. Test that one user cannot read, create, or modify another user's notices.
- **Acceptance criteria:**
  - Missing/invalid credentials are rejected when authentication is required.
  - Caller-supplied identity cannot override the authenticated identity.
  - Cross-user notification access is denied by automated tests.

---

## Additional observations — not security clearance

- `GET /users/me`, `/strategies`, `/brokers/accounts`, and
  `/portfolio/accounts` returned 401 in the recorded checks.
- Detail requests using fabricated UUIDs returned 404 for instruments,
  executions, orders, trades, and positions. These results do not establish
  authentication or ownership enforcement.
- The root route returned 200 and is treated as public for this audit.
- These checks ran against the local in-process FastAPI app, not a deployed
  environment.
- No authenticated cross-user isolation tests have been performed here.

## Release gate

Do not expose execution, order, trade, or position data in the frontend as
user-private functionality until authentication and ownership controls are
implemented and verified with automated tests.

Do not mark any ticket resolved until the acceptance criteria are tested.
