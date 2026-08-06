import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  bearer,
  countAuditLogs,
  createDisbursement,
  createTestApp,
  inject,
  loginAs,
  resetDatabase,
  type TokenPair,
} from "../helpers/test-app.js";

describe("concurrent status transition", () => {
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

  it("two concurrent approvals: exactly one 200, one 409, final status correct, one audit row", async () => {
    const created = await createDisbursement(app, admin.access_token, {
      recipient_name: "CONCURRENT-Approve",
    });
    const id = created.json().data.id;

    const approve = () =>
      inject(app, {
        method: "PATCH",
        url: `/disbursements/${id}/status`,
        headers: bearer(admin.access_token),
        payload: { status: "APPROVED", note: "concurrent approval" },
      });

    const [a, b] = await Promise.all([approve(), approve()]);

    const statusCodes = [a.statusCode, b.statusCode].sort();
    expect(statusCodes).toEqual([200, 409]);

    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.code).toBe("DISBURSEMENT_NOT_PENDING");

    const get = await inject(app, {
      method: "GET",
      url: `/disbursements/${id}`,
      headers: bearer(admin.access_token),
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().data.status).toBe("APPROVED");

    expect(await countAuditLogs("status_changed", id)).toBe(1);
  });
});
