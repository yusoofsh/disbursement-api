# CONTEXT.md — LintasPay Disbursement API

## 1. Mission

Build and submit a production-oriented backend service named:

```text
disbursement-api
```

The service rebuilds a disbursement API that must remain correct under duplicate client requests, concurrent approval attempts, incomplete audit logging, authentication lifecycle requirements, and role-based access control.

The primary goal is **correctness, resilience, and explainable trade-offs**, not feature volume. Deliver a focused implementation that is easy to run, test, review, and explain during an interview.

---

## 2. Source of Truth

Primary specification:

```text
Coding Test — Senior Backend Developer.pdf
```

Operational instructions received from HR:

- Position: Backend Engineer at PT Lintas Pembayaran Digital (LintasPay).
- Submission is expected through a repository link and Google Form.
- HR also mentioned uploading the result to Google Drive.
- The HR message states a deadline of `Sabtu, 07 Agustus 2026, 09.00 WIB`.
- There is an inconsistency:
  - `07 Agustus 2026` is Friday, not Saturday.
  - The PDF states `4 calendar days after the test is sent`.
  - The PDF submission instructions mention GitHub/GitLab plus email, while HR mentions Drive plus Google Form.

Do not block implementation while waiting for clarification. Treat the earliest stated deadline as the working deadline until HR confirms otherwise.

At handoff time:

```text
Current time: 2026-08-06 15:13 WIB
Conservative working deadline: 2026-08-07 09:00 WIB
```

---

## 3. Evaluation Priorities

The assessment explicitly prioritizes:

1. **Resilience and correctness — 35%**
   - Correct idempotency.
   - Concurrent status updates allow only one winner.
   - Refresh token flow works.
   - Logout invalidates refresh tokens.
   - Audit logging is separate and non-blocking.
   - Soft delete preserves data.

2. **System design — 25%**
   - `ARCHITECTURE.md` gives solid reasoning.
   - Code matches the documented decisions.
   - Schema uses appropriate constraints and indexes.

3. **Code quality — 25%**
   - Business logic is outside handlers/controllers.
   - Errors are handled explicitly.
   - Request ID is propagated.
   - Tests cover meaningful edge cases.

4. **API design — 15%**
   - Correct HTTP status codes.
   - Consistent response format.
   - Complete README.

Optimize work in that order. Bonus features must never delay or weaken core correctness.

---

## 4. Required Technology

Use the following unless a repository already exists with an equally valid compatible choice:

```text
Runtime: Node.js 22+
Language: TypeScript
Framework: Fastify
Database: PostgreSQL
ORM/query builder: Drizzle ORM
Validation: Zod or Fastify JSON Schema
Authentication: JWT
Password hashing: Argon2id or bcrypt
Logging: Pino through Fastify
Tests: Vitest
Package manager: nubjs
Containers: Docker and Docker Compose
```

Rationale:

- Fastify is directly allowed by the specification and includes structured logging support.
- PostgreSQL is required for realistic concurrency behavior.
- Drizzle allows typed queries while retaining direct access to atomic SQL.
- Node.js is safer for compliance than relying on Bun as the runtime, even though the code remains TypeScript.

Do not use SQLite.

---

## 5. Scope Guardrails

### Required

- JWT access and refresh tokens.
- Login, refresh, and logout.
- Role-based authorization.
- Disbursement CRUD subset defined below.
- Idempotent disbursement creation.
- Concurrency-safe status transition.
- Soft delete.
- Separate audit log table.
- Non-blocking audit log behavior.
- Structured JSON request logging.
- Request ID propagation and response header.
- Layered architecture.
- Environment-based configuration.
- Database migration.
- Meaningful tests.
- `ARCHITECTURE.md`.
- `README.md`.

### Explicitly not required

- Real payment provider integration.
- Email or notification delivery.
- Production deployment.
- Event-driven microservices.
- Kubernetes.
- Distributed tracing.
- Elaborate domain-driven design.
- A frontend.

### Bonus only after all required work is verified

- `POST /disbursements/batch`.
- Per-user rate limiting.
- `GET /health`.
- Docker Compose.
- Swagger/OpenAPI.

Docker Compose and OpenAPI are valuable, but they remain secondary to core correctness.

---

## 6. Seed Users

Create these users through a deterministic seed script or migration-compatible seed process:

| Username | Password | Role |
|---|---|---|
| `superadmin` | `superadmin123` | `superadmin` |
| `admin` | `admin123` | `admin` |
| `operator` | `operator123` | `operator` |

Never store plaintext passwords. Persist secure password hashes.

### Role permissions

#### operator

- Create disbursements.
- View disbursements.

#### admin

- Everything available to `operator`.
- Change disbursement status.

#### superadmin

- Everything available to `admin`.
- Soft-delete pending disbursements.
- View audit logs.

Authorization must be enforced server-side.

---

## 7. Authentication Requirements

### `POST /auth/login`

Input:

```json
{
  "username": "admin",
  "password": "admin123"
}
```

Output:

- Access token valid for 15 minutes.
- Refresh token valid for 7 days.

### `POST /auth/refresh`

Input should accept a refresh token and issue a new access token.

Recommended behavior:

- Store only a hash of the refresh token.
- Validate that it:
  - exists,
  - belongs to the user encoded in the token,
  - is not expired,
  - is not revoked.
- Rotate refresh tokens if implementation time permits.
- At minimum, issue a fresh access token and preserve correct revocation behavior.

### `POST /auth/logout`

- Invalidate the supplied refresh token.
- Set `revoked_at` in the database.
- Reuse after logout must fail.

### JWT middleware

Every endpoint outside `/auth/*` requires a valid access token.

---

## 8. Core API Requirements

## 8.1 `GET /disbursements`

Supported query parameters:

| Parameter | Type | Rules |
|---|---|---|
| `page` | number | default `1` |
| `limit` | number | default `20`, max `100` |
| `search` | string | partial match on `recipient_name` |
| `status` | string | `PENDING`, `APPROVED`, or `REJECTED` |
| `date_from` | date | `YYYY-MM-DD` |
| `date_to` | date | `YYYY-MM-DD` |
| `sort_by` | string | `created_at` or `amount`, default `created_at` |
| `sort_order` | string | `asc` or `desc`, default `desc` |

Exclude rows with `deleted_at IS NOT NULL`.

Expected response shape:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "total_pages": 0
  }
}
```

Validate all query parameters. Reject invalid enum values and malformed dates with `400`.

---

## 8.2 `GET /disbursements/:id`

Return all disbursement fields, including:

- `updated_at`
- `approved_by`, nullable

Deleted records should behave as not found unless a documented administrative recovery behavior is intentionally added. Do not add recovery behavior unless necessary.

---

## 8.3 `POST /disbursements`

Request:

```json
{
  "recipient_name": "Budi Santoso",
  "account_number": "1234567890",
  "bank_code": "BCA",
  "amount": 1250000,
  "note": "Pembayaran supplier"
}
```

Rules:

- Required:
  - `recipient_name`
  - `account_number`
  - `bank_code`
  - `amount`
- `amount` must be a positive integer.
- Minimum amount: `10000`.
- Initial status: `PENDING`.
- `created_by` comes from the access token.
- `admin_fee`:
  - `2500` when `amount < 5_000_000`
  - `5000` when `amount >= 5_000_000`
- Supports optional `Idempotency-Key`.

Return `201 Created` for a newly created record.

---

## 8.4 `PATCH /disbursements/:id/status`

Request:

```json
{
  "status": "APPROVED",
  "note": "Sudah diverifikasi"
}
```

Rules:

- Only `admin` and `superadmin`.
- Allowed target status:
  - `APPROVED`
  - `REJECTED`
- Only a `PENDING` record can transition.
- A terminal record cannot be changed again.
- `approved_by` comes from the access token.
- The operation must be concurrency-safe.
- When two concurrent requests target the same record, exactly one succeeds.
- The loser receives a clear conflict response.

Recommended implementation:

```sql
UPDATE disbursements
SET
  status = $1,
  note = COALESCE($2, note),
  approved_by = $3,
  updated_at = NOW()
WHERE id = $4
  AND status = 'PENDING'
  AND deleted_at IS NULL
RETURNING *;
```

Interpret zero returned rows carefully:

1. If no record exists or it is soft-deleted: `404 Not Found`.
2. If the record exists but is not pending: `409 Conflict`.
3. Do not return a generic internal error.

This atomic compare-and-set approach is preferred over a read-then-update flow.

---

## 8.5 `DELETE /disbursements/:id`

Rules:

- Only `superadmin`.
- Only a `PENDING` record can be deleted.
- Use soft delete:

```text
deleted_at = current timestamp
```

- Never physically delete the row.
- Record the action in the audit log.

Suggested responses:

- Success: `204 No Content` or a consistent `200` body.
- Missing row: `404`.
- Non-pending row: `409`.
- Unauthorized role: `403`.

Choose one consistent convention and document it.

---

## 9. Idempotency Design

`POST /disbursements` supports:

```http
Idempotency-Key: <uuid-v4>
```

Rules:

- The header is optional.
- Without it, creation works normally without an idempotency guarantee.
- Reusing the same key within 24 hours returns the identical stored response.
- A replayed response must include:

```http
X-Idempotent-Replayed: true
```

- A newly processed request should omit the header or set it to `false`.
- The second request must not create another disbursement or audit side effect.

### Recommended table

```text
idempotency_keys
- id
- user_id
- idempotency_key
- request_hash
- response_status
- response_body
- resource_id
- created_at
- expires_at
```

Recommended unique constraint:

```text
UNIQUE (user_id, idempotency_key)
```

Scope the key by authenticated user unless a strong reason is documented otherwise.

### Payload mismatch

When the same user reuses a key with a different normalized payload:

```text
409 Conflict
```

Return a clear message such as:

```json
{
  "success": false,
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "The idempotency key was already used with a different request payload."
  }
}
```

### Concurrency requirement

The idempotency implementation must also handle two simultaneous first-use requests.

Acceptable strategies:

#### Preferred: transaction plus PostgreSQL advisory lock

1. Begin transaction.
2. Acquire a transaction-scoped advisory lock derived from `(user_id, idempotency_key)`.
3. Look up the key again inside the lock.
4. Replay if completed.
5. Otherwise create the disbursement, write its audit event, and persist the exact response.
6. Commit.

#### Alternative: insert-first state machine

Use a unique constraint and states such as `PROCESSING` and `COMPLETED`, with careful handling for the losing request.

Avoid:

- In-memory caches.
- Read-then-insert without a unique constraint.
- Returning a non-identical response on replay.
- Treating a unique violation as a generic `500`.

### Expiration

- Store `expires_at = created_at + 24 hours`.
- Expired records may be ignored or cleaned asynchronously.
- A cleanup job is optional.
- Document the chosen behavior.

---

## 10. Concurrency and Locking Decision

Use optimistic atomic state transition rather than holding a long pessimistic row lock.

Preferred operation:

```sql
UPDATE ...
WHERE id = ?
  AND status = 'PENDING'
RETURNING *;
```

Trade-offs to explain in `ARCHITECTURE.md`:

### Advantages

- One database round trip for the state transition.
- No application-level race window.
- Low lock duration.
- Simple under high contention.
- Easy to scale across application instances.

### Limitations

- The losing request requires a follow-up lookup to distinguish `404` from `409`.
- More complex transitions may later require a transaction or explicit row lock.
- External side effects would require an outbox or additional coordination.

Do not implement:

```text
SELECT record
if pending:
    UPDATE record
```

unless both operations are protected by a transaction and a lock.

---

## 11. Audit Logging

Create a separate `audit_logs` table.

Required example fields:

```text
id
entity_id
action
actor_id
actor_username
before
after
request_id
created_at
```

`before` and `after` should use PostgreSQL `jsonb`.

Required actions include at least:

```text
created
status_changed
deleted
```

### `GET /audit-logs`

- Only `superadmin`.
- Supported filters:
  - `entity_id`
  - `action`
  - `date_from`
  - `date_to`
- Standard pagination.
- Sort newest first by default.

### Non-blocking requirement

The specification says audit log failure must not block the main operation.

Implement the simplest honest interpretation:

1. Complete the primary transaction.
2. Attempt to insert the audit log.
3. Catch insertion errors.
4. Log a structured server error containing:
   - `request_id`
   - entity ID
   - action
   - failure details
5. Return success for the primary operation.

Document the trade-off:

- This satisfies the stated non-blocking behavior.
- It can lose an audit event during failure.
- A production-grade evolution would use a transactional outbox and a background worker.

Do not silently claim guaranteed audit delivery.

---

## 12. Structured Logging and Request ID

Every request must emit structured JSON logs with at least:

```json
{
  "level": "info",
  "timestamp": "2025-06-12T08:00:00Z",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "PATCH",
  "path": "/disbursements/DSB-001/status",
  "status_code": 200,
  "latency_ms": 42,
  "user": "admin"
}
```

Requirements:

- Generate one request ID per request.
- Honor a valid inbound `X-Request-ID` only if a deliberate policy is documented; otherwise generate a UUID.
- Attach the request ID to Fastify request context.
- Every service and repository log within the request must include it.
- Include the same value in the response:

```http
X-Request-ID: <uuid>
```

Do not log:

- Plaintext passwords.
- Raw refresh tokens.
- JWTs.
- Sensitive account details beyond what is necessary.

---

## 13. Response and Error Contract

Use one consistent format.

### Success

```json
{
  "success": true,
  "data": {}
}
```

### Failure

```json
{
  "success": false,
  "error": {
    "code": "DISBURSEMENT_NOT_PENDING",
    "message": "Only pending disbursements can be updated."
  }
}
```

Recommended status mapping:

| Condition | Status |
|---|---:|
| Created | `201` |
| Successful read/update | `200` |
| Successful empty delete | `204` |
| Invalid body/query/header | `400` |
| Invalid or missing authentication | `401` |
| Authenticated but insufficient role | `403` |
| Resource not found | `404` |
| Duplicate/conflicting state/idempotency mismatch | `409` |
| Rate limit, if implemented | `429` |
| Database unavailable in health endpoint | `503` |
| Unexpected internal failure | `500` |

Never expose raw database errors to clients.

---

## 14. Suggested Database Schema

Use UUID primary keys unless a clear alternative is documented.

## 14.1 `users`

```text
id uuid primary key
username varchar unique not null
password_hash text not null
role enum/check not null
created_at timestamptz not null
updated_at timestamptz not null
```

Indexes:

```text
UNIQUE(username)
```

---

## 14.2 `refresh_tokens`

```text
id uuid primary key
user_id uuid not null references users(id)
token_hash text unique not null
expires_at timestamptz not null
revoked_at timestamptz null
created_at timestamptz not null
```

Indexes:

```text
UNIQUE(token_hash)
INDEX(user_id)
INDEX(expires_at)
```

---

## 14.3 `disbursements`

```text
id uuid primary key
recipient_name varchar not null
account_number varchar not null
bank_code varchar not null
amount bigint not null
admin_fee integer not null
note text null
status enum/check not null default 'PENDING'
created_by uuid not null references users(id)
approved_by uuid null references users(id)
created_at timestamptz not null
updated_at timestamptz not null
deleted_at timestamptz null
```

Constraints:

```text
amount >= 10000
admin_fee IN (2500, 5000)
status IN ('PENDING', 'APPROVED', 'REJECTED')
```

Indexes:

```text
INDEX(status, created_at DESC) WHERE deleted_at IS NULL
INDEX(created_at DESC) WHERE deleted_at IS NULL
INDEX(amount) WHERE deleted_at IS NULL
INDEX(created_by)
```

For search, a simple `ILIKE '%query%'` is sufficient for this assessment. A trigram index is optional and should only be added if the extension setup remains simple and documented.

---

## 14.4 `idempotency_keys`

```text
id uuid primary key
user_id uuid not null references users(id)
idempotency_key uuid not null
request_hash text not null
response_status integer not null
response_body jsonb not null
resource_id uuid null references disbursements(id)
created_at timestamptz not null
expires_at timestamptz not null
```

Constraints and indexes:

```text
UNIQUE(user_id, idempotency_key)
INDEX(expires_at)
```

---

## 14.5 `audit_logs`

```text
id uuid primary key
entity_id uuid not null
action varchar not null
actor_id uuid null
actor_username varchar not null
before jsonb null
after jsonb null
request_id uuid not null
created_at timestamptz not null
```

Indexes:

```text
INDEX(entity_id, created_at DESC)
INDEX(action, created_at DESC)
INDEX(created_at DESC)
```

Do not add a cascading foreign key from audit logs to disbursements that could undermine audit retention.

---

## 15. Layered Architecture

Use a straightforward modular structure:

```text
src/
  app.ts
  server.ts

  config/
    env.ts

  db/
    client.ts
    schema/
      users.ts
      refresh-tokens.ts
      disbursements.ts
      idempotency-keys.ts
      audit-logs.ts
    migrations/
    seed.ts

  plugins/
    auth.ts
    request-context.ts
    error-handler.ts

  shared/
    errors/
    http/
    logging/
    types/
    utils/

  modules/
    auth/
      auth.routes.ts
      auth.handler.ts
      auth.service.ts
      auth.repository.ts
      auth.schema.ts
      auth.types.ts

    disbursements/
      disbursement.routes.ts
      disbursement.handler.ts
      disbursement.service.ts
      disbursement.repository.ts
      disbursement.schema.ts
      disbursement.types.ts
      disbursement.policy.ts

    audit-logs/
      audit-log.routes.ts
      audit-log.handler.ts
      audit-log.service.ts
      audit-log.repository.ts
      audit-log.schema.ts

test/
  unit/
  integration/
```

Responsibilities:

### Handler

- Parse validated input.
- Read authenticated user.
- Call service.
- Set headers and HTTP status.
- No business rules.

### Service

- Enforce business rules.
- Calculate fees.
- Coordinate repositories.
- Define transaction boundaries.
- Map domain outcomes to typed application errors.

### Repository

- Database access only.
- Atomic update queries.
- Pagination queries.
- No HTTP concerns.

### Model/schema

- Database schema.
- Input/output types.
- Validation schemas.

Avoid excessive abstractions, generic base repositories, command buses, or unnecessary dependency injection frameworks.

---

## 16. Environment Variables

At minimum:

```dotenv
NODE_ENV=development
PORT=3000
HOST=0.0.0.0

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/disbursement

JWT_ACCESS_SECRET=replace-with-long-random-secret
JWT_REFRESH_SECRET=replace-with-another-long-random-secret
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

LOG_LEVEL=info
```

Provide:

```text
.env.example
```

Fail fast on invalid or missing required configuration.

Never commit real secrets.

---

## 17. Mandatory Tests

Prioritize behavior, not mocks.

## 17.1 Unit tests

### Admin fee

Test at least:

```text
amount = 10_000      => 2_500
amount = 4_999_999   => 2_500
amount = 5_000_000   => 5_000
amount > 5_000_000   => 5_000
amount < 10_000      => validation error
non-integer amount   => validation error
```

### Status transition

Test:

```text
PENDING -> APPROVED succeeds
PENDING -> REJECTED succeeds
APPROVED -> any status fails
REJECTED -> any status fails
operator cannot update status
invalid target status fails
```

### Idempotency logic

Test:

```text
no key creates normally
first use creates once
same key + same payload replays identical response
replay sets X-Idempotent-Replayed: true
same key + different payload returns 409
expired key behavior matches documentation
```

---

## 17.2 Integration tests

Use a real PostgreSQL test database where practical.

Critical cases:

1. Two concurrent requests approve the same pending disbursement:
   - exactly one `200`,
   - exactly one `409`,
   - final status is correct,
   - only one status-change audit event is written.

2. Two concurrent creates use the same idempotency key:
   - both receive the same response body,
   - one response is newly processed,
   - one is replayed,
   - exactly one disbursement exists,
   - exactly one creation audit event exists.

3. Refresh token:
   - login produces tokens,
   - refresh succeeds,
   - logout revokes,
   - revoked token fails.

4. RBAC:
   - operator cannot approve,
   - admin cannot delete,
   - superadmin can view audit logs.

5. Soft delete:
   - pending record is marked with `deleted_at`,
   - normal list/get excludes it,
   - physical row still exists.

Avoid tests that only assert that a mock function was called.

---

## 18. Documentation Deliverables

## 18.1 `ARCHITECTURE.md`

The PDF asks for two answers of approximately 150–250 words each.

Required sections:

### 1.1 Idempotency

Explain:

- `Idempotency-Key` contract.
- User-scoped unique key.
- Request hashing.
- PostgreSQL persistence.
- 24-hour expiry.
- Concurrency control for simultaneous retries.
- Replay of exact response.
- Payload mismatch behavior.
- Why in-memory storage was rejected.
- Trade-offs.

### 1.2 Concurrency and locking

Explain:

- Atomic conditional update.
- Why it is optimistic concurrency.
- How exactly one request wins.
- How the loser receives a clear conflict.
- Advantages over a read-then-write flow.
- Trade-offs compared with `SELECT ... FOR UPDATE`.

Keep the answers direct and ensure the implementation matches them.

---

## 18.2 `README.md`

Must include:

1. Project summary.
2. Chosen stack.
3. Architecture overview.
4. Prerequisites.
5. Environment setup.
6. Docker Compose instructions, if available.
7. Local setup without Docker.
8. Migration command.
9. Seed command.
10. Run command.
11. Test command.
12. Endpoint list.
13. Seed credentials.
14. Example login and API calls.
15. Database schema overview.
16. Idempotency behavior.
17. Concurrency behavior.
18. Audit-log failure trade-off.
19. Assumptions and known limitations.
20. AI/tooling disclosure if desired or requested.

Ensure every documented command has been executed successfully before submission.

---

## 19. Optional OpenAPI

Add Swagger only after all core requirements and tests pass.

If implemented:

```text
GET /documentation
```

Document:

- Auth endpoints.
- Bearer token security scheme.
- Idempotency header.
- Filters and pagination.
- Response schemas.
- Error schemas.

Do not spend time polishing Swagger while critical tests remain incomplete.

---

## 20. Suggested Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run test/integration",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/db/seed.ts"
  }
}
```

Adjust to the actual implementation. Do not document nonexistent scripts.

---

## 21. Implementation Sequence

Work in this order.

### Phase 0 — Inspect and plan

- Inspect the current repository.
- Do not overwrite existing valuable work.
- Record the initial Git status.
- Read this file and the original PDF.
- Create a concise internal checklist.

### Phase 1 — Bootstrap

- Initialize Node.js TypeScript project if needed.
- Add Fastify, Drizzle, PostgreSQL driver, validation, JWT, hashing, and test dependencies.
- Configure TypeScript, linting, formatting, and environment validation.
- Add application and server entry points.

### Phase 2 — Database

- Define schema.
- Add migration.
- Add seed users.
- Verify migration and seed against PostgreSQL.

### Phase 3 — Shared infrastructure

- Request ID.
- Structured logging.
- Error types and error handler.
- Auth plugin.
- Role guard.

### Phase 4 — Authentication

- Login.
- Refresh.
- Logout.
- Token persistence and revocation.
- Authentication tests.

### Phase 5 — Read/create disbursements

- Fee calculation.
- Create.
- Get one.
- List/filter/sort/paginate.
- Validation and RBAC.

### Phase 6 — Idempotency

- Request hash.
- Persistent key table.
- Concurrency-safe first processing.
- Exact replay response.
- Replay header.
- Mismatch conflict.
- Tests.

### Phase 7 — Status concurrency

- Atomic transition query.
- Correct `404` versus `409`.
- Audit behavior.
- Concurrent integration test.

### Phase 8 — Delete and audit API

- Soft delete.
- Audit filters and pagination.
- Superadmin authorization.
- Non-blocking audit error handling.

### Phase 9 — Documentation and packaging

- `ARCHITECTURE.md`.
- `README.md`.
- `.env.example`.
- Dockerfile.
- Docker Compose, if time remains.
- OpenAPI, if time remains.

### Phase 10 — Final verification

Run all relevant commands and record actual results.

---

## 22. Definition of Done

The submission is done only when all statements below are true.

### Functional

- [ ] Login returns a 15-minute access token and 7-day refresh token.
- [ ] Refresh returns a valid access token.
- [ ] Logout invalidates the refresh token.
- [ ] Every non-auth endpoint requires JWT.
- [ ] RBAC matches the specification.
- [ ] Disbursement list supports all specified filters, pagination, and sorting.
- [ ] Create validates required fields and minimum amount.
- [ ] Fee threshold is correct.
- [ ] Initial status is always `PENDING`.
- [ ] `created_by` comes from JWT.
- [ ] Same idempotency key and payload produce one record and identical responses.
- [ ] Idempotency replay sets `X-Idempotent-Replayed: true`.
- [ ] Same key with a different payload returns `409`.
- [ ] Concurrent status updates yield exactly one winner.
- [ ] A terminal status cannot be changed.
- [ ] `approved_by` comes from JWT.
- [ ] Only a pending disbursement can be soft-deleted.
- [ ] Deleted records remain physically stored.
- [ ] Audit records exist for create, status change, and delete.
- [ ] Audit failure does not fail the main operation.
- [ ] Audit API is restricted to superadmin.
- [ ] Every response has `X-Request-ID`.
- [ ] Request logs are JSON and contain required fields.

### Engineering

- [ ] PostgreSQL is used.
- [ ] At least one real migration creates all tables.
- [ ] Constraints and indexes reflect the design.
- [ ] Handlers contain no business logic.
- [ ] Errors are explicit and safe.
- [ ] Configuration comes from environment variables.
- [ ] No plaintext secrets or passwords are committed.
- [ ] Core unit tests cover edge cases.
- [ ] Concurrent integration tests pass.
- [ ] Build passes.
- [ ] Typecheck passes.
- [ ] Lint passes.
- [ ] Tests pass.
- [ ] Application starts from documented instructions.
- [ ] Fresh database migration and seed succeed.

### Documentation

- [ ] `ARCHITECTURE.md` contains both required answers.
- [ ] Code matches `ARCHITECTURE.md`.
- [ ] README setup commands are verified.
- [ ] README lists endpoints and credentials.
- [ ] README describes schema and trade-offs.
- [ ] Submission link points to the correct accessible repository.

---

## 23. Final Verification Commands

Use commands appropriate to the final repository. Expected baseline:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
docker compose up -d --build
pnpm db:migrate
pnpm db:seed
```

Then perform smoke tests:

```bash
curl -i http://localhost:3000/health
```

Login:

```bash
curl -i \
  -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

Create with idempotency:

```bash
curl -i \
  -X POST http://localhost:3000/disbursements \
  -H 'authorization: Bearer <ACCESS_TOKEN>' \
  -H 'content-type: application/json' \
  -H 'idempotency-key: <UUID_V4>' \
  -d '{
    "recipient_name":"Budi Santoso",
    "account_number":"1234567890",
    "bank_code":"BCA",
    "amount":1250000,
    "note":"Pembayaran supplier"
  }'
```

Repeat the same request and confirm:

```text
same HTTP status
same response body
X-Idempotent-Replayed: true
only one database row
```

Run or write a small concurrency script for simultaneous approval and verify exactly one winner.

---

## 24. Git and Commit Strategy

Keep commits small enough to review but do not waste time on artificial granularity.

Suggested commits:

```text
chore: bootstrap fastify typescript service
feat: add database schema migrations and seed users
feat: implement jwt authentication and token revocation
feat: add disbursement queries and creation
feat: add persistent idempotency handling
feat: make status transitions concurrency safe
feat: add soft delete and audit log access
test: cover critical business and concurrency cases
docs: add architecture decisions and setup guide
```

Before submission:

```bash
git status
git log --oneline --decorate -n 15
git diff --check
```

Ensure:

- no uncommitted required work,
- no secrets,
- no generated junk,
- no database credentials,
- repository visibility/access matches the submission instructions.

---

## 25. Agent Operating Instructions

The implementation agent should operate autonomously within this scope.

### Required behavior

- Start by inspecting the repository and existing files.
- Prefer the smallest robust implementation.
- Use the database to enforce integrity and concurrency.
- Write tests for critical behavior before declaring completion.
- Execute commands rather than assuming they work.
- Fix failures completely.
- Keep architecture and code consistent.
- Record assumptions in README.
- Preserve evidence of verification.
- Do not claim success without command output.

### Do not

- Overengineer.
- Introduce microservices.
- Add Kafka, Redis, or queues unless strictly necessary.
- Use in-memory idempotency.
- Use SQLite.
- put business rules in handlers.
- Use a read-then-write status update.
- Swallow unexpected errors without logs.
- expose raw stack traces to API consumers.
- Spend core time on styling documentation.
- Implement bonus features before mandatory correctness.
- Change requirements silently.
- Depend on external paid services.

### Decision authority

The agent may make reasonable implementation decisions without pausing, provided they:

1. remain within the specification,
2. prioritize correctness,
3. are documented,
4. are covered by tests where material.

Ask for user input only when blocked by:

- missing repository access,
- missing credentials that cannot be replaced locally,
- destructive operations,
- a requirement conflict that materially changes the deliverable.

The known deadline/submission inconsistencies are already documented and should not block development.

---

## 26. Final Handoff Report Format

At completion, return a concise report using this structure:

```markdown
## Result

Implementation status and repository path.

## Architecture

- Idempotency approach
- Concurrency approach
- Refresh-token approach
- Audit-log failure approach

## Implemented

- Core endpoints
- RBAC
- Logging
- Migrations
- Tests
- Documentation
- Bonus features, if any

## Verification

- install:
- migration:
- seed:
- typecheck:
- lint:
- tests:
- build:
- smoke test:
- concurrent idempotency:
- concurrent approval:

## Files Changed

List the important files.

## Known Limitations

Only factual remaining limitations.

## Submission Checklist

- repository URL
- repository access
- Google Form
- Drive upload, if confirmed
- HR clarification status
```

Do not provide vague statements such as “should work.” Report exact test counts, exact commands, and any remaining failure.

---

## 27. Completion Goal

Deliver a repository that demonstrates senior backend judgment through:

- database-backed idempotency,
- atomic state transitions,
- explicit authentication and token revocation,
- strict RBAC,
- defensible schema constraints and indexes,
- non-blocking but honestly documented audit behavior,
- structured request-correlated logging,
- meaningful concurrency tests,
- clear architecture reasoning,
- reproducible local execution.

The ideal result is not the largest implementation. It is the smallest implementation that is demonstrably correct, resilient, reviewable, and explainable.
