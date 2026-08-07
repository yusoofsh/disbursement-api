import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createDb } from "../../src/db/client.js";
import { idempotencyKeys } from "../../src/db/schema.js";
import { TEST_DATABASE_URL } from "../helpers/test-app.js";
import {
  bearer,
  countAuditLogs,
  createDisbursement,
  createTestApp,
  decodeSub,
  inject,
  loginAs,
  resetDatabase,
  type TokenPair,
} from "../helpers/test-app.js";

describe("status transition idempotency", () => {
  let app: App;
  let admin: TokenPair;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    admin = await loginAs(app, "admin");
  });

  afterAll(async () => {
    await app.close();
  });

  async function createPending(recipientName: string): Promise<string> {
    const res = await createDisbursement(app, admin.access_token, { recipient_name: recipientName });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  }

  function patchStatus(
    id: string,
    key: string,
    payload: Record<string, unknown> = { status: "APPROVED", note: "Sudah diverifikasi" },
  ) {
    return inject(app, {
      method: "PATCH",
      url: `/disbursements/${id}/status`,
      headers: { ...bearer(admin.access_token), "idempotency-key": key },
      payload,
    });
  }

  async function insertExpiredIdempotencyKey(userId: string, key: string) {
    const { db, pool } = createDb(TEST_DATABASE_URL);
    try {
      await db.insert(idempotencyKeys).values({
        userId,
        idempotencyKey: key,
        requestHash: "stale-hash",
        responseStatus: 200,
        responseBody: { success: true, data: { id: "00000000-0000-4000-8000-000000000001" } },
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

  it("replays the identical response for the same key and payload, with one audit event", async () => {
    const id = await createPending("STIDEM-Same");
    const key = crypto.randomUUID();

    const first = await patchStatus(id, key);
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-idempotent-replayed"]).toBe("false");

    const second = await patchStatus(id, key);
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-idempotent-replayed"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    expect(second.json().data.status).toBe("APPROVED");

    expect(await countAuditLogs("status_changed", id)).toBe(1);
  });

  it("returns 409 for a reused key with a different payload, without corrupting the stored response", async () => {
    const id = await createPending("STIDEM-Mismatch");
    const key = crypto.randomUUID();

    const first = await patchStatus(id, key);
    expect(first.statusCode).toBe(200);

    const mismatch = await patchStatus(id, key, { status: "REJECTED", note: "different" });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await countAuditLogs("status_changed", id)).toBe(1);

    // The failed attempt must not have clobbered the stored response.
    const replay = await patchStatus(id, key);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["x-idempotent-replayed"]).toBe("true");
    expect(replay.json()).toEqual(first.json());
    expect(await countAuditLogs("status_changed", id)).toBe(1);
  });

  it("two concurrent transitions with the same key: one fresh 200, one replayed 200, one audit row", async () => {
    const id = await createPending("STIDEM-Concurrent");
    const key = crypto.randomUUID();

    const [a, b] = await Promise.all([patchStatus(id, key), patchStatus(id, key)]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect([a, b].filter((r) => r.headers["x-idempotent-replayed"] === "true")).toHaveLength(1);
    expect([a, b].filter((r) => r.headers["x-idempotent-replayed"] === "false")).toHaveLength(1);

    expect(await countAuditLogs("status_changed", id)).toBe(1);
  });

  it("reuses an expired key as a fresh transition (no replay, row replaced)", async () => {
    const id = await createPending("STIDEM-ExpiredKey");
    const key = crypto.randomUUID();
    const adminId = decodeSub(admin.access_token);
    await insertExpiredIdempotencyKey(adminId, key);

    const res = await patchStatus(id, key);
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-idempotent-replayed"]).toBe("false");

    const row = await findIdempotencyRow(adminId, key);
    expect(row).toBeDefined();
    expect(row!.requestHash).not.toBe("stale-hash");
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a malformed or non-v4 key with 400", async () => {
    const id = await createPending("STIDEM-BadKey");

    const malformed = await inject(app, {
      method: "PATCH",
      url: `/disbursements/${id}/status`,
      headers: { ...bearer(admin.access_token), "idempotency-key": "not-a-uuid" },
      payload: { status: "APPROVED" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("INVALID_IDEMPOTENCY_KEY");

    // v1 UUID: correct shape, wrong version — must be rejected too.
    const v1 = await inject(app, {
      method: "PATCH",
      url: `/disbursements/${id}/status`,
      headers: { ...bearer(admin.access_token), "idempotency-key": "7d444840-9dc0-11d1-b15a-00c04fc304eb" },
      payload: { status: "APPROVED" },
    });
    expect(v1.statusCode).toBe(400);
    expect(v1.json().error.code).toBe("INVALID_IDEMPOTENCY_KEY");

    // No transition may have happened.
    expect(await countAuditLogs("status_changed", id)).toBe(0);
  });

  it("a key previously used for a create is a payload mismatch on PATCH (409)", async () => {
    const key = crypto.randomUUID();
    const created = await inject(app, {
      method: "POST",
      url: "/disbursements",
      headers: { ...bearer(admin.access_token), "idempotency-key": key },
      payload: {
        recipient_name: "STIDEM-CrossEndpoint",
        account_number: "1234567890",
        bank_code: "BCA",
        amount: 1_250_000,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    const res = await patchStatus(id, key);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});
