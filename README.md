# disbursement-api

LintasPay Senior Backend Developer assessment — a production-oriented disbursement service: idempotent retries, concurrency-safe status transitions, soft delete, JWT auth with refresh rotation, RBAC, and non-blocking audit logging.

## 🚀 Live demo

**→ [Interactive demo & technical explainer](https://www.yusoofsh.id/static/disbursement-api/index.html)**

The demo drives the live API at `https://disbursement.yusoofsh.cloud` and falls back to an in-browser simulator with the same contract (RBAC, idempotent replay, the 409 concurrency loser, soft delete, audit trail, CSV export). Live OpenAPI docs: `GET /documentation` (Swagger UI).

## Quick start (Docker)

```bash
docker compose up -d
docker compose exec api node dist/db/seed.js
```

API on `http://localhost:3000` — uses the CI-built `ghcr.io/yusoofsh/disbursement-api:latest` image, migrations run automatically on start.

```bash
# local, without Docker
createdb disbursement
cp .env.example .env
pnpm install && pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Stack

Node 22 · TypeScript (strict) · Fastify 5 · PostgreSQL 16 · Drizzle ORM · Zod + JSON Schema · Vitest · pnpm (upstream/CI/Docker) with `nub` supported locally.

## Endpoints

| Method | Path | Roles | Notes |
|---|---|---|---|
| `POST` | `/auth/login` · `/refresh` · `/logout` | public | token pair (15m/7d), rotation, revocation |
| `GET` | `/health` | public | `200` / `503` |
| `GET` | `/disbursements` | operator+ | pagination, search, filters, sorting |
| `GET` | `/disbursements/:id` | operator+ | soft-deleted = `404` |
| `GET` | `/disbursements/export` | operator+ | Excel-compatible CSV (same filters) |
| `POST` | `/disbursements` | operator+ | optional `Idempotency-Key`; `201` |
| `POST` | `/disbursements/batch` | operator+ | 1–100 creates, all-or-nothing |
| `PATCH` | `/disbursements/:id/status` | admin+ | `PENDING` → approved/rejected; one winner under concurrency |
| `DELETE` | `/disbursements/:id` | superadmin | soft delete, `PENDING` only, `204` |
| `GET` | `/audit-logs` | superadmin | newest first, filterable |

Every response carries `X-Request-ID` and uses `{ success, data, meta? }` / `{ success: false, error: { code, message } }`.

## Seed credentials

| Username | Password | Role |
|---|---|---|
| `superadmin` | `superadmin123` | superadmin |
| `admin` | `admin123` | admin |
| `operator` | `operator123` | operator |

## Commands

| Command | Description |
|---|---|
| `pnpm dev` | run with `tsx watch` |
| `pnpm build` / `pnpm start` | compile / run `dist/` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` (·`:unit` ·`:integration`) | Vitest suites |
| `pnpm db:generate` · `db:migrate` · `db:seed` | Drizzle migrations / seed |

## Highlights

- **Idempotency** — optional `Idempotency-Key` (UUID), user-scoped, persisted 24h in PostgreSQL, advisory-lock serialized; replay returns the stored response byte-for-byte with `X-Idempotent-Replayed: true`; key reuse with a different payload → `409`.
- **Concurrency** — status changes use `UPDATE … WHERE status = 'PENDING'` (atomic compare-and-set); losers get `404` or `409`.
- **Rate limiting** — 30/min per user on create/batch; 10/min per IP on login; configurable via env.
- **CSV export** — `GET /disbursements/export` → UTF-8 BOM, RFC 4180 quoting, CRLF, ISO timestamps, attachment header; opens in Excel/Sheets.
- **Soft delete** — rows stay recoverable/auditable; `GET` → `404`, list excludes them.
- **Non-blocking audit** — written post-commit; a failure never blocks the business op (logged).

## Deploy

Every `main` push is built and pushed by CI to `ghcr.io/yusoofsh/disbursement-api` (`latest` + SHA, amd64/arm64). Runs migrations on start; needs `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (32+ chars), optional `PORT`/`HOST`/`CORS_ORIGIN`/rate-limit/`LOG_LEVEL`.

```bash
docker pull ghcr.io/yusoofsh/disbursement-api:latest
docker run -d --name disbursement-api -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:postgres@db-host:5432/disbursement \
  -e JWT_ACCESS_SECRET='<64+ random>' \
  -e JWT_REFRESH_SECRET='<64+ random>' \
  -e CORS_ORIGIN='https://www.yusoofsh.id' \
  ghcr.io/yusoofsh/disbursement-api:latest
docker exec disbursement-api node dist/db/seed.js
```

For the demo page's live console, list the page origin in `CORS_ORIGIN`.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — idempotency, concurrency, audit trade-offs
- [CONTEXT.md](CONTEXT.md) — assessment spec & decisions
- Swagger UI `GET /documentation` · OpenAPI JSON `GET /documentation/json`

*Developed with AI assistance; all decisions and trade-offs are documented above.*
