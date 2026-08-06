import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  bearer,
  countWhere,
  createDisbursementPayload,
  createTestApp,
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
});
