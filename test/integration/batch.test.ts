import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  bearer,
  countAuditLogs,
  countRows,
  createDisbursementPayload,
  createTestApp,
  decodeSub,
  inject,
  loginAs,
  resetDatabase,
  type TokenPair,
} from "../helpers/test-app.js";

describe("batch create", () => {
  let app: App;
  let operator: TokenPair;
  let operatorId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    operator = await loginAs(app, "operator");
    operatorId = decodeSub(operator.access_token);
  });

  afterAll(async () => {
    await app.close();
  });

  function batch(items: Record<string, unknown>[]) {
    return inject(app, {
      method: "POST",
      url: "/disbursements/batch",
      headers: bearer(operator.access_token),
      payload: { items },
    });
  }

  it("operator creates 3 items in one request: all rows PENDING, per-item fee, one audit entry each", async () => {
    const res = await batch([
      createDisbursementPayload({ recipient_name: "BATCH-One", amount: 1_250_000 }),
      createDisbursementPayload({ recipient_name: "BATCH-Two", amount: 5_000_000 }),
      createDisbursementPayload({ recipient_name: "BATCH-Three", amount: 100_000 }),
    ]);

    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.created).toBe(3);
    expect(data.items).toHaveLength(3);

    const byName = Object.fromEntries(
      data.items.map((d: { recipient_name: string }) => [d.recipient_name, d]),
    );
    expect(byName["BATCH-One"].admin_fee).toBe(2500);
    expect(byName["BATCH-Two"].admin_fee).toBe(5000);
    expect(byName["BATCH-Three"].admin_fee).toBe(2500);
    for (const item of data.items) {
      expect(item.status).toBe("PENDING");
      expect(item.created_by).toBe(operatorId);
      expect(item.approved_by).toBeNull();
    }

    expect(await countAuditLogs("created")).toBe(3);
  });

  it("rejects a batch with one invalid item with 400 and creates zero rows", async () => {
    const before = await countRows("disbursements");
    const res = await batch([
      createDisbursementPayload({ recipient_name: "BATCH-InvalidPair" }),
      createDisbursementPayload({ amount: 9_999 }),
      createDisbursementPayload({ recipient_name: "BATCH-InvalidTail" }),
    ]);

    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(await countRows("disbursements")).toBe(before);
    expect(await countAuditLogs("created")).toBe(3); // unchanged from the first test
  });

  it("rejects empty and oversized batches with 400", async () => {
    const empty = await batch([]);
    expect(empty.statusCode).toBe(400);

    const oversized = await batch(
      Array.from({ length: 101 }, (_, i) =>
        createDisbursementPayload({ recipient_name: `BATCH-Oversize-${i}` }),
      ),
    );
    expect(oversized.statusCode).toBe(400);
  });

  it("rejects unauthenticated batch requests with 401", async () => {
    const res = await inject(app, {
      method: "POST",
      url: "/disbursements/batch",
      payload: { items: [createDisbursementPayload()] },
    });
    expect(res.statusCode).toBe(401);
  });
});
