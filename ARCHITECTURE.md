# ARCHITECTURE.md — LintasPay Disbursement API

## 1. Idempotency

`POST /disbursements` accepts an optional `Idempotency-Key` header containing a UUID. The key is scoped to the authenticated user: `idempotency_keys` carries a `UNIQUE (user_id, idempotency_key)` constraint, so two different users may reuse the same key without interfering. Before any write, the request body is normalized to a fixed field order (`recipient_name`, `account_number`, `bank_code`, `amount`, `note`) and hashed with SHA-256, which makes payload comparison stable regardless of JSON key order.

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
