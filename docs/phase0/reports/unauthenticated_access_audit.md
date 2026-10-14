# Unauthenticated GET Access Audit

- Generated (UTC): 2026-10-14T14:04:33.752617+00:00
- Requests: 20
- Request methods: GET only
- Response bodies saved: No

| Category | Route | Status | Assessment |
|---|---|---:|---|
| Public | `GET /` | 200 | PUBLIC_ROUTE_RESPONDED |
| Protected | `GET /users/me` | 401 | AUTH_REJECTED |
| Protected | `GET /strategies` | 401 | AUTH_REJECTED |
| Protected | `GET /strategies/00000000-0000-0000-0000-000000000001` | 401 | AUTH_REJECTED |
| Catalogue policy unresolved | `GET /instruments` | 200 | RESPONDED_WITHOUT_AUTH_REVIEW_REQUIRED |
| Catalogue policy unresolved | `GET /instruments/00000000-0000-0000-0000-000000000001` | 404 | NOT_FOUND_IN_THIS_REQUEST |
| Protected | `GET /brokers/accounts` | 401 | AUTH_REJECTED |
| Protected | `GET /brokers/accounts/00000000-0000-0000-0000-000000000001` | 401 | AUTH_REJECTED |
| Security review required | `GET /executions` | 200 | RESPONDED_WITHOUT_AUTH_REVIEW_REQUIRED |
| Security review required | `GET /executions/00000000-0000-0000-0000-000000000001` | 404 | NOT_FOUND_IN_THIS_REQUEST |
| Security review required | `GET /orders` | 200 | RESPONDED_WITHOUT_AUTH_REVIEW_REQUIRED |
| Security review required | `GET /orders/00000000-0000-0000-0000-000000000001` | 404 | NOT_FOUND_IN_THIS_REQUEST |
| Security review required | `GET /trades` | 200 | RESPONDED_WITHOUT_AUTH_REVIEW_REQUIRED |
| Security review required | `GET /trades/00000000-0000-0000-0000-000000000001` | 404 | NOT_FOUND_IN_THIS_REQUEST |
| Security review required | `GET /positions` | 200 | RESPONDED_WITHOUT_AUTH_REVIEW_REQUIRED |
| Security review required | `GET /positions/00000000-0000-0000-0000-000000000001` | 404 | NOT_FOUND_IN_THIS_REQUEST |
| Protected | `GET /portfolio/accounts` | 401 | AUTH_REJECTED |
| Security review required | `GET /portfolio/accounts/00000000-0000-0000-0000-000000000001` | 401 | AUTH_REJECTED |
| Security review required | `GET /notifications` | 422 | INCONCLUSIVE_REVIEW_REQUIRED |
| Security review required | `GET /notifications/00000000-0000-0000-0000-000000000001` | 422 | INCONCLUSIVE_REVIEW_REQUIRED |

## Limitations

- GET-only local in-process checks; no mutations intentionally performed.
- A response is a signal for review, not proof of an exploitable vulnerability.
- A 404 does not establish that authentication is enforced.
- A 500 or request error is inconclusive.
- Ownership isolation and authenticated cross-user access were not tested.
- Catalogue write authorization requires separate review.
