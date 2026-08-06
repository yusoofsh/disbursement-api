import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  bearer,
  createDisbursement,
  createTestApp,
  inject,
  loginAs,
  resetDatabase,
  type TokenPair,
} from "../helpers/test-app.js";

describe("csv export", () => {
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

  it("exports matching rows as Excel-compatible CSV with attachment headers", async () => {
    await createDisbursement(app, operator.access_token, {
      recipient_name: 'PT. "Sumber" Makmur, Jaya',
      note: "Catatan, dengan koma\nbaris kedua",
      amount: 6_000_000,
    });
    await createDisbursement(app, operator.access_token, { recipient_name: "Other Corp", amount: 50_000 });

    const res = await inject(app, {
      method: "GET",
      url: "/disbursements/export",
      headers: bearer(operator.access_token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toMatch(/attachment; filename="disbursements-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv"/);

    const body = res.body;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('"recipient_name"');
    expect(body).toContain('"PT. ""Sumber"" Makmur, Jaya"');
    expect(body).toContain('"Catatan, dengan koma\nbaris kedua"');
    expect(body).toContain('"6000000"');
    expect(body).toContain('"5000"');
    expect(body).toContain('"50000"');
    expect(body).toContain('"2500"');
  });

  it("applies status/date filters to the export", async () => {
    const created = await createDisbursement(app, operator.access_token, {
      recipient_name: "Filter Me",
      amount: 100_000,
    });
    const id = created.json().data.id;

    const filtered = await inject(app, {
      method: "GET",
      url: `/disbursements/export?status=APPROVED&search=Filter%20Me&date_from=2020-01-01&date_to=2099-01-01`,
      headers: bearer(operator.access_token),
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.body).not.toContain("Filter Me");

    await inject(app, {
      method: "PATCH",
      url: `/disbursements/${id}/status`,
      headers: bearer((await loginAs(app, "admin")).access_token),
      payload: { status: "APPROVED" },
    });

    const approved = await inject(app, {
      method: "GET",
      url: "/disbursements/export?status=APPROVED",
      headers: bearer(operator.access_token),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.body).toContain("Filter Me");
    expect(approved.body).toContain('"APPROVED"');
  });

  it("rejects unauthenticated exports and invalid filters", async () => {
    const unauth = await inject(app, { method: "GET", url: "/disbursements/export" });
    expect(unauth.statusCode).toBe(401);

    const badFilter = await inject(app, {
      method: "GET",
      url: "/disbursements/export?status=NOPE",
      headers: bearer(operator.access_token),
    });
    expect(badFilter.statusCode).toBe(400);
  });
});
