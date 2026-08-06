import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createDb } from "../../src/db/client.js";
import { TEST_DATABASE_URL } from "../helpers/test-app.js";
import { idempotencyKeys } from "../../src/db/schema.js";
import {
  hashRequestPayload,
  type CreateDisbursementInput,
} from "../../src/modules/disbursements/disbursement.service.js";
import {
  bearer,
  countWhere,
  createDisbursementPayload,
  createTestApp,
  decodeSub,
  inject,
  loginAs,
  resetDatabase,
  type TokenPair,
} from "../helpers/test-app.js";

describe("idempotency", () => {
  let app: App;
  let operator: TokenPair;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    operator = await loginAs(app, "operator");
  });

  afterAll(async () => {
    await app.close();
  });

  function createWithKey(idempotencyKey: string, overrides: Record<string, unknown> = {}) {
    return inject(app, {
      method: "POST",
      url: "/disbursements",
      headers: { ...bearer(operator.access_token), "idempotency-key": idempotencyKey },
      payload: createDisbursementPayload(overrides),
    });
  }

  /** Seed an already-expired idempotency row directly, as if created 24h+ ago. */
  async function insertExpiredIdempotencyKey(
    userId: string,
    key: string,
    requestHash: string,
    responseBody: unknown,
  ) {
    const { db, pool } = createDb(TEST_DATABASE_URL);
    try {
      await db.insert(idempotencyKeys).values({
        userId,
        idempotencyKey: key,
        requestHash,
        responseStatus: 201,
        responseBody,
        expiresAt: new Date(Date.now() - 60_000),
      });
    } finally {
      await pool.end();
    }
  }

  async function findIdempotencyRow(userId: string, key: string) {
    const { db, pool } = createDb(TEST_DATABASE_URL);
    try {
      const rows = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.idempotencyKey, key)))
        .limit(1);
      return rows[0];
    } finally {
      await pool.end();
    }
  }

  it("replays the identical response for the same key and payload, creating one row", async () => {
    const key = crypto.randomUUID();

    const first = await createWithKey(key, { recipient_name: "IDEM-Same" });
    expect(first.statusCode).toBe(201);
    expect(first.headers["x-idempotent-replayed"]).toBe("false");

    const second = await createWithKey(key, { recipient_name: "IDEM-Same" });
    expect(second.statusCode).toBe(201);
    expect(second.headers["x-idempotent-replayed"]).toBe("true");
    expect(second.json()).toEqual(first.json());

    expect(await countWhere("disbursements", "recipient_name", "IDEM-Same")).toBe(1);
    expect(await countWhere("idempotency_keys", "idempotency_key", key)).toBe(1);
  });

  it("returns 409 when the same key is reused with a different payload", async () => {
    const key = crypto.randomUUID();

    const first = await createWithKey(key, { recipient_name: "IDEM-Original" });
    expect(first.statusCode).toBe(201);

    const second = await createWithKey(key, { recipient_name: "IDEM-Changed", amount: 5_000_000 });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("two concurrent creates with the same key produce one row and exactly one replay", async () => {
    const key = crypto.randomUUID();

    const [a, b] = await Promise.all([
      createWithKey(key, { recipient_name: "IDEM-Concurrent" }),
      createWithKey(key, { recipient_name: "IDEM-Concurrent" }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 201]);
    expect(b.json()).toEqual(a.json());

    const replayed = [a, b].filter((r) => r.headers["x-idempotent-replayed"] === "true");
    expect(replayed).toHaveLength(1);

    expect(await countWhere("disbursements", "recipient_name", "IDEM-Concurrent")).toBe(1);
    expect(await countWhere("idempotency_keys", "idempotency_key", key)).toBe(1);
  });

  it("reuses an expired key as a fresh request: no replay, expired row replaced, no unique-violation 500", async () => {
    // Documented behavior: "expired keys are ignored; the key may be reused
    // after expiry". The expired row still occupies the (user_id, key) unique
    // slot, so the create path must replace it instead of failing the insert.
    const key = crypto.randomUUID();
    const operatorId = decodeSub(operator.access_token);
    const payload = createDisbursementPayload({ recipient_name: "IDEM-ExpiredKey" });
    const staleResponseId = "00000000-0000-4000-8000-000000000001";
    await insertExpiredIdempotencyKey(operatorId, key, hashRequestPayload(payload as CreateDisbursementInput), {
      success: true,
      data: { id: staleResponseId },
    });

    const res = await createWithKey(key, { recipient_name: "IDEM-ExpiredKey" });

    // A fresh creation, not a replay of the expired stored response.
    expect(res.statusCode).toBe(201);
    expect(res.headers["x-idempotent-replayed"]).toBe("false");
    expect(res.json().data.id).not.toBe(staleResponseId);
    expect(await countWhere("disbursements", "recipient_name", "IDEM-ExpiredKey")).toBe(1);

    // The expired row was replaced by the new one (still exactly one row, fresh TTL).
    expect(await countWhere("idempotency_keys", "idempotency_key", key)).toBe(1);
    const row = await findIdempotencyRow(operatorId, key);
    expect(row).toBeDefined();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
