import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  bearer,
  countAuditLogs,
  countRows,
  createDisbursement,
  createDisbursementPayload,
  createTestApp,
  decodeSub,
  inject,
  loginAs,
  resetDatabase,
  type TokenPair,
} from "../helpers/test-app.js";

describe("disbursements", () => {
  let app: App;
  let operator: TokenPair;
  let admin: TokenPair;
  let superadmin: TokenPair;
  let operatorId: string;
  let adminId: string;
  let superadminId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    operator = await loginAs(app, "operator");
    admin = await loginAs(app, "admin");
    superadmin = await loginAs(app, "superadmin");
    operatorId = decodeSub(operator.access_token);
    adminId = decodeSub(admin.access_token);
    superadminId = decodeSub(superadmin.access_token);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("create", () => {
    it("creates a PENDING disbursement with correct fee and created_by from token", async () => {
      const res = await createDisbursement(app, operator.access_token, {
        recipient_name: "CREATE-Operator",
        amount: 4_999_999,
      });
      expect(res.statusCode).toBe(201);
      const data = res.json().data;
      expect(data.status).toBe("PENDING");
      expect(data.admin_fee).toBe(2500);
      expect(data.created_by).toBe(operatorId);
      expect(data.recipient_name).toBe("CREATE-Operator");
      expect(data.approved_by).toBeNull();
    });

    it("charges 5000 fee at and above 5,000,000", async () => {
      const at = await createDisbursement(app, admin.access_token, { amount: 5_000_000 });
      expect(at.statusCode).toBe(201);
      expect(at.json().data.admin_fee).toBe(5000);

      const above = await createDisbursement(app, admin.access_token, { amount: 6_000_000 });
      expect(above.statusCode).toBe(201);
      expect(above.json().data.admin_fee).toBe(5000);
    });

    it("rejects amount below the 10,000 minimum with 400", async () => {
      const res = await createDisbursement(app, operator.access_token, { amount: 9_999 });
      expect(res.statusCode).toBe(400);
      expect(res.json().success).toBe(false);
    });

    it("rejects non-integer amounts with 400", async () => {
      const res = await createDisbursement(app, operator.access_token, { amount: 12_500.5 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects missing required fields with 400", async () => {
      const res = await inject(app, {
        method: "POST",
        url: "/disbursements",
        headers: bearer(operator.access_token),
        payload: { recipient_name: "No Account Number", amount: 100_000 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a malformed idempotency key with 400", async () => {
      const res = await inject(app, {
        method: "POST",
        url: "/disbursements",
        headers: { ...bearer(operator.access_token), "idempotency-key": "not-a-uuid" },
        payload: createDisbursementPayload(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    });
  });

  describe("list", () => {
    it("supports search, status filter, pagination and sorting", async () => {
      await createDisbursement(app, operator.access_token, {
        recipient_name: "LST-Budi Santoso",
        amount: 100_000,
      });
      await createDisbursement(app, operator.access_token, {
        recipient_name: "LST-Siti Aminah",
        amount: 2_000_000,
      });
      const third = await createDisbursement(app, operator.access_token, {
        recipient_name: "LST-Budi Hartono",
        amount: 6_000_000,
      });
      const thirdId = third.json().data.id;
      await inject(app, {
        method: "PATCH",
        url: `/disbursements/${thirdId}/status`,
        headers: bearer(admin.access_token),
        payload: { status: "APPROVED", note: "approved for list test" },
      });

      // Search narrows to the LST-* rows.
      const searchRes = await inject(app, {
        method: "GET",
        url: "/disbursements?search=LST-Budi&sort_by=amount&sort_order=asc",
        headers: bearer(operator.access_token),
      });
      expect(searchRes.statusCode).toBe(200);
      expect(searchRes.json().data.map((d: { recipient_name: string }) => d.recipient_name)).toEqual([
        "LST-Budi Santoso",
        "LST-Budi Hartono",
      ]);

      // Status filter: only the approved one.
      const approvedRes = await inject(app, {
        method: "GET",
        url: "/disbursements?search=LST&status=APPROVED",
        headers: bearer(operator.access_token),
      });
      expect(approvedRes.statusCode).toBe(200);
      expect(approvedRes.json().data).toHaveLength(1);
      expect(approvedRes.json().data[0].status).toBe("APPROVED");

      // Pagination + amount sort.
      const page1 = await inject(app, {
        method: "GET",
        url: "/disbursements?search=LST&page=1&limit=2&sort_by=amount&sort_order=asc",
        headers: bearer(operator.access_token),
      });
      expect(page1.statusCode).toBe(200);
      expect(page1.json().data.map((d: { amount: number }) => d.amount)).toEqual([100_000, 2_000_000]);
      expect(page1.json().meta).toMatchObject({ page: 1, limit: 2, total: 3, total_pages: 2 });

      const page2 = await inject(app, {
        method: "GET",
        url: "/disbursements?search=LST&page=2&limit=2&sort_by=amount&sort_order=asc",
        headers: bearer(operator.access_token),
      });
      expect(page2.statusCode).toBe(200);
      expect(page2.json().data.map((d: { amount: number }) => d.amount)).toEqual([6_000_000]);
      expect(page2.json().meta.total).toBe(3);

      // Descending amount sort.
      const desc = await inject(app, {
        method: "GET",
        url: "/disbursements?search=LST&sort_by=amount&sort_order=desc",
        headers: bearer(operator.access_token),
      });
      expect(desc.statusCode).toBe(200);
      expect(desc.json().data[0].amount).toBe(6_000_000);
    });

    it("rejects invalid query parameters with 400", async () => {
      const badSort = await inject(app, {
        method: "GET",
        url: "/disbursements?sort_order=up",
        headers: bearer(operator.access_token),
      });
      expect(badSort.statusCode).toBe(400);

      const badStatus = await inject(app, {
        method: "GET",
        url: "/disbursements?status=PAID",
        headers: bearer(operator.access_token),
      });
      expect(badStatus.statusCode).toBe(400);

      const badDate = await inject(app, {
        method: "GET",
        url: "/disbursements?date_from=2026-13-99",
        headers: bearer(operator.access_token),
      });
      expect(badDate.statusCode).toBe(400);

      const calendarInvalid = await inject(app, {
        method: "GET",
        url: "/disbursements?date_from=2026-02-31",
        headers: bearer(operator.access_token),
      });
      expect(calendarInvalid.statusCode).toBe(400);
      expect(calendarInvalid.json().error.code).toBe("INVALID_DATE");
    });
  });

  describe("get by id", () => {
    it("returns 404 for an unknown id", async () => {
      const res = await inject(app, {
        method: "GET",
        url: "/disbursements/00000000-0000-4000-8000-000000000000",
        headers: bearer(operator.access_token),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    });

    it("returns the requested record with all fields", async () => {
      const created = await createDisbursement(app, operator.access_token, {
        recipient_name: "GET-ById",
        note: "single lookup",
      });
      const id = created.json().data.id;
      const res = await inject(app, {
        method: "GET",
        url: `/disbursements/${id}`,
        headers: bearer(operator.access_token),
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.id).toBe(id);
      expect(data.recipient_name).toBe("GET-ById");
      expect(data.created_by).toBe(operatorId);
      expect(typeof data.created_at).toBe("string");
      expect(typeof data.updated_at).toBe("string");
    });
  });

  describe("RBAC", () => {
    it("operator cannot change status (403)", async () => {
      const created = await createDisbursement(app, operator.access_token);
      const id = created.json().data.id;
      const res = await inject(app, {
        method: "PATCH",
        url: `/disbursements/${id}/status`,
        headers: bearer(operator.access_token),
        payload: { status: "APPROVED" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FORBIDDEN");
    });

    it("admin cannot delete (403)", async () => {
      const created = await createDisbursement(app, admin.access_token);
      const id = created.json().data.id;
      const res = await inject(app, {
        method: "DELETE",
        url: `/disbursements/${id}`,
        headers: bearer(admin.access_token),
      });
      expect(res.statusCode).toBe(403);
    });

    it("operator cannot view audit logs (403)", async () => {
      const res = await inject(app, {
        method: "GET",
        url: "/audit-logs",
        headers: bearer(operator.access_token),
      });
      expect(res.statusCode).toBe(403);
    });

    it("superadmin can view audit logs", async () => {
      const res = await inject(app, {
        method: "GET",
        url: "/audit-logs?limit=5",
        headers: bearer(superadmin.access_token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(Array.isArray(res.json().data)).toBe(true);
      expect(typeof res.json().meta.total).toBe("number");
    });

    it("unauthenticated requests are rejected with 401", async () => {
      const res = await inject(app, { method: "GET", url: "/disbursements" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("status transition", () => {
    it("PENDING -> APPROVED succeeds and a second transition conflicts with 409", async () => {
      const created = await createDisbursement(app, admin.access_token, {
        recipient_name: "TRANSITION-One",
      });
      const id = created.json().data.id;

      const first = await inject(app, {
        method: "PATCH",
        url: `/disbursements/${id}/status`,
        headers: bearer(admin.access_token),
        payload: { status: "APPROVED", note: "Sudah diverifikasi" },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().data.status).toBe("APPROVED");
      expect(first.json().data.approved_by).toBe(adminId);
      expect(first.json().data.note).toBe("Sudah diverifikasi");

      const second = await inject(app, {
        method: "PATCH",
        url: `/disbursements/${id}/status`,
        headers: bearer(admin.access_token),
        payload: { status: "REJECTED" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("DISBURSEMENT_NOT_PENDING");
    });

    it("PENDING -> REJECTED works", async () => {
      const created = await createDisbursement(app, admin.access_token);
      const id = created.json().data.id;
      const res = await inject(app, {
        method: "PATCH",
        url: `/disbursements/${id}/status`,
        headers: bearer(superadmin.access_token),
        payload: { status: "REJECTED" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe("REJECTED");
    });

    it("returns 404 when the record does not exist", async () => {
      const res = await inject(app, {
        method: "PATCH",
        url: "/disbursements/00000000-0000-4000-8000-000000000000/status",
        headers: bearer(admin.access_token),
        payload: { status: "APPROVED" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("writes exactly one status_changed audit row", async () => {
      const created = await createDisbursement(app, admin.access_token);
      const id = created.json().data.id;
      await inject(app, {
        method: "PATCH",
        url: `/disbursements/${id}/status`,
        headers: bearer(admin.access_token),
        payload: { status: "APPROVED" },
      });
      expect(await countAuditLogs("status_changed", id)).toBe(1);
      expect(await countAuditLogs("created", id)).toBe(1);
    });
  });

  describe("soft delete", () => {
    it("soft deletes a pending record (200 + success JSON), then GET 404 and list excludes it", async () => {
      const created = await createDisbursement(app, superadmin.access_token, {
        recipient_name: "DEL-DeleteMe",
      });
      const id = created.json().data.id;

      const del = await inject(app, {
        method: "DELETE",
        url: `/disbursements/${id}`,
        headers: bearer(superadmin.access_token),
      });
      expect(del.statusCode).toBe(200);
      expect(del.json().success).toBe(true);
      expect(del.json().data.id).toBe(id);
      expect(del.json().data.deleted_at).not.toBeNull();
      expect(await countAuditLogs("deleted", id)).toBe(1);

      const get = await inject(app, {
        method: "GET",
        url: `/disbursements/${id}`,
        headers: bearer(operator.access_token),
      });
      expect(get.statusCode).toBe(404);

      const list = await inject(app, {
        method: "GET",
        url: "/disbursements?search=DEL-DeleteMe",
        headers: bearer(operator.access_token),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data).toHaveLength(0);
      expect(list.json().meta.total).toBe(0);

      // The row is still physically present.
      expect(await countRows("disbursements")).toBeGreaterThan(0);
    });

    it("cannot soft delete an approved record (409)", async () => {
      const created = await createDisbursement(app, superadmin.access_token);
      const id = created.json().data.id;
      await inject(app, {
        method: "PATCH",
        url: `/disbursements/${id}/status`,
        headers: bearer(admin.access_token),
        payload: { status: "APPROVED" },
      });
      const del = await inject(app, {
        method: "DELETE",
        url: `/disbursements/${id}`,
        headers: bearer(superadmin.access_token),
      });
      expect(del.statusCode).toBe(409);
    });
  });
});
