# disbursement-api

A production-oriented disbursement service for LintasPay's Senior Backend Developer assessment. The API handles disbursement creation (with idempotent retries), concurrency-safe status transitions, soft delete, JWT authentication with refresh-token rotation, role-based access control, and separate non-blocking audit logging.

## Stack

- Node.js 22+ (ESM), TypeScript (strict)
- Fastify 5, Pino structured logging
- PostgreSQL 16, Drizzle ORM (node-postgres driver)
- Zod (unit-level validation) + Fastify JSON Schema (route-level validation)
- JWT via `jsonwebtoken` + `@fastify/jwt`; Argon2id password hashing
- Vitest for unit and integration tests
- Package manager: nub (repo uses `nub.lock`); standard `package.json`, so npm/pnpm equivalents work

## Architecture

The app is layered: **routes → service → repository**, with business rules and fee calculation in the service/policy layer, handlers only parsing input and mapping results to HTTP responses, and repositories owning SQL. Shared plugins provide JWT authentication (`authenticate`), role guards (`requireRole`), the error handler, and request-context/logging. Every request gets a UUID request id that is propagated through logs and returned as `X-Request-ID` on every response.

Key design decisions (idempotency via PostgreSQL + advisory locks, optimistic concurrency via atomic conditional updates, non-blocking audit logging) are explained in [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- Node.js 22+ and nub (or npm/pnpm), **or** Docker with Docker Compose
- PostgreSQL 16 (local install or the provided Docker container)

`argon2` ships prebuilt binaries for common platforms (macOS arm64, Linux x64 glibc); on other platforms you may need a C toolchain.

## Environment setup

```bash
cp .env.example .env
```

Required: `DATABASE_URL`, plus `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (each at least 32 characters). `NODE_ENV`, `PORT`, `HOST`, `JWT_ACCESS_TTL` (default `15m`), `JWT_REFRESH_TTL` (default `7d`), and `LOG_LEVEL` have defaults. The app fails fast on invalid or missing configuration.

Rate-limit knobs (requests per minute, see [Rate limiting](#rate-limiting)):

| Variable | Default | Purpose |
|---|---|---|
| `RATE_LIMIT_MAX` | `200` | Global per-client limit for all routes |
| `RATE_LIMIT_LOGIN_MAX` | `10` | Stricter per-IP limit for `POST /auth/login` |

## Docker Compose (recommended)

```bash
docker compose up -d --build
```

This starts `postgres:16-alpine` (volume `pgdata`, `pg_isready` healthcheck) and the API on `http://localhost:3000`. The API container runs migrations automatically on start (`node dist/db/migrate.js && node dist/server.js`). JWT secrets come from your `.env` via Compose interpolation, with dev-only defaults that meet the 32-character minimum — replace them before anything real.

Seed the three users once the API is healthy:

```bash
docker compose exec api node dist/db/seed.js
```

(The image ships only production dependencies, so `tsx`/nub are not available inside the container; the compiled seed runs directly. Locally, `nub run db:seed` is the equivalent.)

Other useful commands:

```bash
docker compose ps
docker compose logs -f api
docker compose down        # keeps the pgdata volume
docker compose down -v     # also deletes the database volume
```

## Local setup without Docker

```bash
# 1. PostgreSQL 16 must be running locally
createdb disbursement

# 2. Install and configure
cp .env.example .env       # point DATABASE_URL at your local Postgres
nub install                # or: npm install / pnpm install

# 3. Create the schema and seed users
nub run db:migrate
nub run db:seed

# 4. Run
nub run dev                # http://localhost:3000
```

## Commands

| Command | Description |
|---|---|
| `nub run dev` | Start with `tsx watch` |
| `nub run build` | Compile TypeScript to `dist/` |
| `nub run start` | Run the compiled app (`node dist/server.js`) |
| `nub run typecheck` | `tsc --noEmit` |
| `nub run test` | Run all Vitest suites |
| `nub run test:unit` | Unit tests only |
| `nub run test:integration` | Integration tests only |
| `nub run db:generate` | Generate Drizzle migrations from `src/db/schema.ts` |
| `nub run db:migrate` | Apply migrations (`tsx src/db/migrate.ts`) |
| `nub run db:seed` | Seed users (`tsx src/db/seed.ts`) |

`nub exec <bin>` runs any local binary (e.g. `nub exec tsc`). All scripts are plain `package.json` entries, so npm/pnpm equivalents (`npm run build`, `pnpm test`, …) work unchanged.

## Endpoints

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/auth/login` | public | Returns access (15m) + refresh (7d) tokens |
| `POST` | `/auth/refresh` | public | Rotates the refresh token; revokes the presented one |
| `POST` | `/auth/logout` | public | Revokes the presented refresh token |
| `GET` | `/health` | public | `200` or `503 DATABASE_UNAVAILABLE` |
| `GET` | `/disbursements` | operator, admin, superadmin | Pagination, search, status/date filters, sorting; excludes soft-deleted |
| `GET` | `/disbursements/:id` | operator, admin, superadmin | Single disbursement; soft-deleted = `404` |
| `POST` | `/disbursements` | operator, admin, superadmin | Optional `Idempotency-Key` (UUID); `201` |
| `POST` | `/disbursements/batch` | operator, admin, superadmin | 1–100 creates atomically; no `Idempotency-Key` support; `201` |
| `PATCH` | `/disbursements/:id/status` | admin, superadmin | `PENDING` → `APPROVED`/`REJECTED`; exactly one winner under concurrency |
| `DELETE` | `/disbursements/:id` | superadmin | Soft delete, `PENDING` only, `204` |
| `GET` | `/audit-logs` | superadmin | Filters: `entity_id`, `action`, `date_from`, `date_to`; newest first |

Interactive API documentation (OpenAPI) is served at `http://localhost:3000/documentation` (Swagger UI) and `http://localhost:3000/documentation/json` (OpenAPI 3 JSON).

All responses follow `{ "success": true, "data": ..., "meta": ... }` or `{ "success": false, "error": { "code", "message" } }`, and every response carries `X-Request-ID`.

## Seed credentials

| Username | Password | Role |
|---|---|---|
| `superadmin` | `superadmin123` | superadmin |
| `admin` | `admin123` | admin |
| `operator` | `operator123` | operator |

## Example API calls

```bash
# 1. Login (operator can create; use admin/superadmin for later steps)
curl -s http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"operator","password":"operator123"}'
# → data.access_token, data.refresh_token, expires_in: 900

export ACCESS_TOKEN='<access_token>'
export ADMIN_TOKEN='<admin access_token>'
export SUPERADMIN_TOKEN='<superadmin access_token>'

# 2. Create with an Idempotency-Key (UUID v4, lowercase)
export KEY=$(uuidgen | tr 'A-Z' 'a-z')
curl -i -X POST http://localhost:3000/disbursements \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -H "idempotency-key: $KEY" \
  -d '{"recipient_name":"Budi Santoso","account_number":"1234567890","bank_code":"BCA","amount":1250000,"note":"Pembayaran supplier"}'

# 3. Replay the exact same request → identical body, X-Idempotent-Replayed: true,
#    no second disbursement, no extra audit event
curl -i -X POST http://localhost:3000/disbursements \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -H "idempotency-key: $KEY" \
  -d '{"recipient_name":"Budi Santoso","account_number":"1234567890","bank_code":"BCA","amount":1250000,"note":"Pembayaran supplier"}'

# 4. Status transition (admin/superadmin)
curl -X PATCH http://localhost:3000/disbursements/$DISBURSEMENT_ID/status \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"status":"APPROVED","note":"Sudah diverifikasi"}'

# 5. Soft delete (superadmin, PENDING only)
curl -i -X DELETE http://localhost:3000/disbursements/$DISBURSEMENT_ID \
  -H "authorization: Bearer $SUPERADMIN_TOKEN"

# 6. Audit logs (superadmin)
curl http://localhost:3000/audit-logs?action=status_changed&limit=10 \
  -H "authorization: Bearer $SUPERADMIN_TOKEN"

# 7. Batch create (1-100 items, all-or-nothing; Idempotency-Key is NOT supported)
curl -X POST http://localhost:3000/disbursements/batch \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"items":[{"recipient_name":"Budi Santoso","account_number":"1234567890","bank_code":"BCA","amount":1250000},{"recipient_name":"Siti Aminah","account_number":"0987654321","bank_code":"BCA","amount":6000000}]}'
# → 201 {"success":true,"data":{"created":2,"items":[...]}}
```

## Batch disbursements

`POST /disbursements/batch` creates 1–100 disbursements in a single request. It is available to the same roles as single create (operator, admin, superadmin).

Request body:

```json
{
  "items": [
    {
      "recipient_name": "Budi Santoso",
      "account_number": "1234567890",
      "bank_code": "BCA",
      "amount": 1250000,
      "note": "Pembayaran supplier"
    }
  ]
}
```

Rules:

- Each item follows the exact single-create rules (required fields, `amount >= 10000` integer, per-item `admin_fee` of 2500/5000 based on the item's own amount).
- The whole request is validated by the Fastify JSON schema first: any invalid item rejects the entire request with `400` and nothing is created.
- Valid items are inserted in **one transaction** (all-or-nothing): a failure rolls back the whole batch.
- All items start `PENDING`; `created_by` comes from the JWT.
- One audit entry (`action: "created"`) is written per disbursement, non-blocking, after the transaction commits.
- `Idempotency-Key` is **not supported** on this endpoint. The header is ignored (no replay behavior, no rejection); send duplicate batches at your own risk.

Response (`201 Created`):

```json
{
  "success": true,
  "data": {
    "created": 2,
    "items": [ "<disbursement object>", "<disbursement object>" ]
  }
}
```

## Rate limiting

Per-client rate limiting is provided by `@fastify/rate-limit` with a 1-minute window:

- A generous global limit (`RATE_LIMIT_MAX`, default `200`/minute) applies to every route.
- `POST /auth/login` gets a stricter limit (`RATE_LIMIT_LOGIN_MAX`, default `10`/minute per IP) to protect credential checking.
- Buckets are keyed by the authenticated user id (`sub` claim) for routes that carry a Bearer token, falling back to the client IP for public routes (login, refresh, logout, health, docs). The JWT is only decoded for keying — forged tokens still fail authentication.
- Exceeding a limit returns `429` with the standard error contract: `{ "success": false, "error": { "code": "RATE_LIMITED", "message": "..." } }`, plus rate-limit headers.

Both values are configurable via environment variables, so deployments can raise them and tests can lower them.

## Swagger/OpenAPI

- Swagger UI: `GET http://localhost:3000/documentation`
- OpenAPI 3 JSON: `GET http://localhost:3000/documentation/json`

The docs are public (no auth) and include a Bearer security scheme. Routes are tagged (`auth`, `disbursements`, `audit-logs`, `health`); request schemas, summaries, and the optional `Idempotency-Key` header on `POST /disbursements` are documented.

## Database schema

Five tables, all with UUID primary keys:

| Table | Key points |
|---|---|
| `users` | `username` unique; `role` check (`superadmin`/`admin`/`operator`); Argon2id hash in `password_hash` |
| `refresh_tokens` | `token_hash` unique (only the SHA-256 hash of a refresh token is stored); FKs `user_id` → `users`; indexes on `user_id` and `expires_at`; `revoked_at` for revocation |
| `disbursements` | Checks: `amount >= 10000`, `admin_fee IN (2500, 5000)`, `status IN ('PENDING','APPROVED','REJECTED')`; FKs `created_by`/`approved_by` → `users`; partial indexes on `(status, created_at DESC)`, `(created_at DESC)`, `(amount)` where `deleted_at IS NULL`; index on `created_by` |
| `idempotency_keys` | `UNIQUE (user_id, idempotency_key)`; stores `request_hash`, `response_status`, `response_body` (jsonb), `resource_id` → `disbursements`; `expires_at` index |
| `audit_logs` | `entity_id` with **no** FK (audit retention must outlive rows); `before`/`after` jsonb; `request_id`; indexes on `(entity_id, created_at DESC)`, `(action, created_at DESC)`, `(created_at DESC)` |

## Idempotency behavior

- `Idempotency-Key` is optional and must be a UUID; invalid values → `400 INVALID_IDEMPOTENCY_KEY`.
- Keys are user-scoped (`UNIQUE (user_id, idempotency_key)`) and persisted in PostgreSQL for 24 hours — never in memory, so replays survive restarts and multiple instances.
- The payload is normalized (fixed key order) and SHA-256 hashed for comparison.
- A replay returns the stored response byte-for-byte with `X-Idempotent-Replayed: true` and creates no side effects (no second row, no audit event).
- Same key, different payload → `409 IDEMPOTENCY_KEY_REUSED`.
- Simultaneous first uses are serialized by a transaction-scoped `pg_advisory_xact_lock` on `(user_id, key)`; the loser re-checks inside the lock and replays.
- Expired keys are ignored and treated as a fresh request. Because the expired row still occupies the `(user_id, key)` unique slot, the create path deletes it inside the advisory-lock transaction and inserts a new row — the key is genuinely reusable and no unique-violation can occur.
- `POST /disbursements/batch` does **not** support `Idempotency-Key`; the header is ignored there.

## Concurrency behavior

Status changes use `UPDATE ... WHERE id = ? AND status = 'PENDING' AND deleted_at IS NULL RETURNING *` — an atomic compare-and-set. Under concurrent requests exactly one succeeds; losers get a follow-up lookup that distinguishes `404 NOT_FOUND` (missing/soft-deleted) from `409 DISBURSEMENT_NOT_PENDING` (already terminal). Only one `status_changed` audit event is written. Rationale and trade-offs are in ARCHITECTURE.md.

## Audit-log failure trade-off

Audit entries are written **after** the primary transaction commits. If the insert fails, the error is caught and logged as a structured server error (with `request_id`, entity id, action, and failure details), and the main operation still succeeds. This satisfies the "audit must not block the business operation" requirement, at the cost of possible audit loss during failures. A production evolution would be a transactional outbox with a background worker.

## Assumptions and known limitations

- `date_from`/`date_to` are interpreted as UTC (`T00:00:00.000Z` through `T23:59:59.999Z`), not local time.
- `search` uses `ILIKE '%term%'` on `recipient_name` without a trigram (`pg_trgm`) index — fine at assessment scale, not for large datasets.
- Refresh tokens are rotated on every refresh; the presented token is revoked, so a reused/rotated token is rejected. There is no explicit reuse-detection beyond that revocation.
- Audit events can be lost if the post-commit insert fails (documented trade-off above).
- Expired idempotency rows are not cleaned up by a background job; they are removed lazily when the same key is reused.
- `amount` must be a JSON integer (bigint); non-integers are rejected by the route schema.
- The production Docker image contains only runtime dependencies, so in-container one-off commands use the compiled `dist/` entry points (`node dist/db/migrate.js`, `node dist/db/seed.js`) rather than `tsx`.
- The repo ships `nub.lock` and no `package-lock.json`, so the Dockerfile uses `npm install` (switch to `npm ci` if a `package-lock.json` is added).

## AI/tooling disclosure

This repository was developed with AI assistance. All implementation decisions and trade-offs are documented in ARCHITECTURE.md and this README; the assessment spec lives in CONTEXT.md.
