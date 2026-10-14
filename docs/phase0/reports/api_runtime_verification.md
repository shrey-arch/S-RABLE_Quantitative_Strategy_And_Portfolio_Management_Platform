# API Runtime Smoke Verification

- Generated (UTC): 2026-10-14T14:02:58.354852+00:00
- Total checks: 6
- Passed: 6
- Failed: 0
- Database mutations: none intended
- Full endpoint verification: NOT COMPLETE
- Security and ownership audit: NOT COMPLETE

## Results

| Check | Expected | Actual | Result |
|---|---|---|---|
| Root endpoint | 200 | 200 | PASS |
| Strategies require authentication | 401 | 401 | PASS |
| Broker accounts require authentication | 401 | 401 | PASS |
| Portfolio accounts require authentication | 401 | 401 | PASS |
| Login rejects missing fields | 422 | 422 | PASS |
| Registration rejects missing fields | 422 | 422 | PASS |

### Root endpoint
- Request: `GET /`
- Purpose: Basic application response
- Response: `200`
- Body excerpt: `{"message": "Welcome to Quantitative Backtesting Platform!"}`

### Strategies require authentication
- Request: `GET /strategies`
- Purpose: Reject unauthenticated access
- Response: `401`
- Body excerpt: `{"detail": "Not authenticated"}`

### Broker accounts require authentication
- Request: `GET /brokers/accounts`
- Purpose: Reject unauthenticated access
- Response: `401`
- Body excerpt: `{"detail": "Not authenticated"}`

### Portfolio accounts require authentication
- Request: `GET /portfolio/accounts`
- Purpose: Reject unauthenticated access
- Response: `401`
- Body excerpt: `{"detail": "Not authenticated"}`

### Login rejects missing fields
- Request: `POST /auth/login`
- Purpose: Request schema validation before handler execution
- Response: `422`
- Body excerpt: `{"detail": [{"type": "missing", "loc": ["body", "email"], "msg": "Field required", "input": {}}, {"type": "missing", "loc": ["body", "password"], "msg": "Field required", "input": {}}]}`

### Registration rejects missing fields
- Request: `POST /auth/register`
- Purpose: Request schema validation before handler execution
- Response: `422`
- Body excerpt: `{"detail": [{"type": "missing", "loc": ["body", "full_name"], "msg": "Field required", "input": {}}, {"type": "missing", "loc": ["body", "email"], "msg": "Field required", "input": {}}, {"type": "missing", "loc": ["body", "password"], "msg": "Field required", "input": {}}]}`

## Limitations

- These are local in-process HTTP checks, not deployed-server tests.
- Only the listed requests were exercised.
- No valid registration or login was attempted.
- No authenticated database-backed CRUD operation was attempted.
- No resource ownership or cross-user isolation was verified.
- A passing authentication rejection does not prove all routes are protected.
- Security-sensitive routes remain unverified until dedicated tests exist.
