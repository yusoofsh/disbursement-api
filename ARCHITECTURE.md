# ARCHITECTURE.md — LintasPay Disbursement API

## 1. Idempotency

`POST /disbursements` accepts an optional `Idempotency-Key` header containing a UUID v4. `PATCH /disbursements/:id/status` supports the same header with the same semantics (see 2.2 of the spec), so a retried approval replays the winning response instead of failing with `409` and never writes a second audit event. The key is scoped to the authenticated user: `idempotency_keys` carries a `UNIQUE (user_id, idempotency_key)` constraint, so two different users may reuse the same key without interfering. Before any write, the request payload is normalized to a fixed field order and hashed with SHA-256 (`recipient_name`, `account_number`, `bank_code`, `amount`, `note` for creates; `id`, `status`, `note` for status transitions), which makes payload comparison stable regardless of JSON key order.

The hash, the exact stored response (status code plus JSON body), and the created resource id are persisted in PostgreSQL with `expires_at = created_at + 24 hours`. No in-memory cache is involved, so replay guarantees hold across multiple instances and process restarts. A completed key replays the identical stored response with `X-Idempotent-Replayed: true` and creates no second disbursement and no audit event. Reusing a key with a different payload hash returns `409 IDEMPOTENCY_KEY_REUSED`.

Simultaneous first uses are serialized by a transaction-scoped `pg_advisory_xact_lock` derived from `(user_id, idempotency_key)`; the losing transaction re-checks inside the lock and replays instead of inserting. Trade-offs: rows accumulate until an optional cleanup job removes expired entries, the full response body is stored (a small storage cost that buys byte-identical replays), and an expired key is treated as a fresh request.

## 2. Concurrency and Locking

Disbursement status transitions and soft deletes use an atomic conditional update:

```sql
UPDATE disbursements
SET status = $1, approved_by = $2, updated_at = NOW()
WHERE id = $3 AND status = 'PENDING' AND deleted_at IS NULL
RETURNING *;
```

This is optimistic concurrency: the `WHERE` clause is a compare-and-set predicate evaluated atomically by PostgreSQL while the row is being updated. Under concurrent requests the first update locks and changes the row; every other request matches zero rows, so exactly one transition wins and exactly one `status_changed` audit event is written.

A zero-row result is disambiguated with a follow-up lookup: a missing or soft-deleted record returns `404 NOT_FOUND`, while an existing non-pending record returns `409 DISBURSEMENT_NOT_PENDING`. The loser always receives a clear, typed conflict rather than a generic error.

Advantages over a read-then-write flow: one database round trip, no time-of-check-to-time-of-use window, the row lock is held only for the update itself, and no application-level coordination, so it scales across instances. Trade-offs versus `SELECT ... FOR UPDATE`: pessimistic locking serializes contenders inside an explicit transaction and blocks while held; the CAS approach requires the follow-up lookup and only covers single-row transitions, so multi-row workflows or external side effects would need transactions, an outbox, or additional coordination.

## 3. Refresh Token Storage

Refresh tokens are stored as SHA-256 hashes in the `refresh_tokens` table (`token_hash` is unique, `expires_at` is indexed, and `revoked_at` marks revocation). The raw token is never persisted; a leaked database cannot be replayed to mint access tokens, and a leaked token alone is useless without its hash row.

We chose the database over an in-memory store for three reasons. First, revocation must survive restarts and scale across instances: with more than one API process, an in-memory map is per-process, so a token revoked on instance A would still work on instance B. Second, rotation is atomic and auditable — refreshing revokes the presented token and issues a fresh pair in the same request, and the row history records every issued token. Third, expiration is enforceable in the query itself (`revoked_at IS NULL AND expires_at > NOW()`), so no background sweeper is required for correctness.

Trade-offs: every login, refresh, and logout costs one indexed write or lookup (negligible at this volume), and an attacker with database read access plus a captured token can still detect the hash match via brute force — mitigated here by the 256-bit entropy of the token itself. The access token remains stateless (JWT, 15 minutes) so request hot paths never touch the database; only token lifecycle events do.
