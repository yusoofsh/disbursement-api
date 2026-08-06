import { describe, expect, it } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../../src/db/client.js";
import type { Disbursement } from "../../src/db/schema.js";
import { DisbursementService, type Actor } from "../../src/modules/disbursements/disbursement.service.js";
import type { DisbursementRepository } from "../../src/modules/disbursements/disbursement.repository.js";
import { AuditLogService } from "../../src/modules/audit-logs/audit-log.service.js";
import type { AuditLogEntry, AuditLogRepository } from "../../src/modules/audit-logs/audit-log.repository.js";

const dbStub = {} as Db;

function makeDisbursement(overrides: Partial<Disbursement> = {}): Disbursement {
  return {
    id: "5f2a10c3-4dd7-4b8e-9b51-2a1f7b1c3d4e",
    recipientName: "Budi",
    accountNumber: "123",
    bankCode: "BCA",
    amount: 1_250_000,
    adminFee: 2500,
    note: null,
    status: "PENDING",
    createdBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    approvedBy: null,
    createdAt: new Date("2026-08-06T10:00:00.000Z"),
    updatedAt: new Date("2026-08-06T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  } as Disbursement;
}

class FakeRepository {
  raw: Disbursement | undefined;
  softDeleteResult: Disbursement | undefined;
  deletedCalls = 0;

  async findRawById(id: string): Promise<Disbursement | undefined> {
    return this.raw?.id === id ? this.raw : undefined;
  }
  async softDelete(id: string): Promise<Disbursement | undefined> {
    this.deletedCalls += 1;
    return this.softDeleteResult?.id === id ? this.softDeleteResult : undefined;
  }
}

class FakeAuditRepository implements Pick<AuditLogRepository, "insert"> {
  entries: AuditLogEntry[] = [];
  async insert(entry: AuditLogEntry) {
    this.entries.push(entry);
    return {} as never;
  }
}

const logger = { error: () => undefined } as unknown as FastifyBaseLogger;
const superadmin: Actor = { id: "u1", username: "superadmin", role: "superadmin" };
const admin: Actor = { id: "u2", username: "admin", role: "admin" };
const operator: Actor = { id: "u3", username: "operator", role: "operator" };

function makeService(repo: FakeRepository, auditRepo: FakeAuditRepository) {
  const audit = new AuditLogService(auditRepo as unknown as AuditLogRepository);
  return new DisbursementService(dbStub, repo as unknown as DisbursementRepository, audit);
}

describe("soft delete service", () => {
  it("forbids non-superadmin roles before touching the repository", async () => {
    const repo = new FakeRepository();
    const audit = new FakeAuditRepository();
    const service = makeService(repo, audit);

    await expect(service.softDelete(admin, "any-id", "req-1", logger)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(service.softDelete(operator, "any-id", "req-1", logger)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repo.deletedCalls).toBe(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("soft-deletes a pending record and records a deleted audit entry", async () => {
    const pending = makeDisbursement();
    const repo = new FakeRepository();
    repo.raw = pending;
    repo.softDeleteResult = { ...pending, deletedAt: new Date("2026-08-06T11:00:00.000Z") };
    const audit = new FakeAuditRepository();
    const service = makeService(repo, audit);

    const result = await service.softDelete(superadmin, pending.id, "req-1", logger);
    expect(repo.deletedCalls).toBe(1);
    expect(result.id).toBe(pending.id);
    expect(result.status).toBe("PENDING");
    expect(result.deleted_at).toEqual(new Date("2026-08-06T11:00:00.000Z"));
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      entityId: pending.id,
      action: "deleted",
      actorId: "u1",
      actorUsername: "superadmin",
      requestId: "req-1",
    });
    expect(audit.entries[0].after).toMatchObject({ deleted_at: expect.any(Date) });
  });

  it("maps a missing or already-soft-deleted record to 404", async () => {
    const repo = new FakeRepository();
    const audit = new FakeAuditRepository();
    const service = makeService(repo, audit);
    await expect(service.softDelete(superadmin, "unknown-id", "req-1", logger)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });

    repo.raw = makeDisbursement({ deletedAt: new Date() });
    await expect(service.softDelete(superadmin, repo.raw.id, "req-1", logger)).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND",
    });
    expect(audit.entries).toHaveLength(0);
  });

  it("maps a non-pending record to 409 and writes no audit entry", async () => {
    const approved = makeDisbursement({ status: "APPROVED", approvedBy: "u2" });
    const repo = new FakeRepository();
    repo.raw = approved;
    const audit = new FakeAuditRepository();
    const service = makeService(repo, audit);

    await expect(service.softDelete(superadmin, approved.id, "req-1", logger)).rejects.toMatchObject({
      statusCode: 409,
      code: "DISBURSEMENT_NOT_PENDING",
    });
    expect(audit.entries).toHaveLength(0);
  });
});
