import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { idempotencyKeys, type Disbursement, type UserRole } from "../../db/schema.js";
import { errors } from "../../shared/errors/app-error.js";
import { sha256 } from "../../shared/utils/hash.js";
import { validateDateFilter } from "../../shared/utils/date-filter.js";
import type { AuditLogService } from "../audit-logs/audit-log.service.js";
import type { FastifyBaseLogger } from "fastify";
import { calculateAdminFee, canChangeStatus, canCreateDisbursement, canDeleteDisbursement } from "./disbursement.policy.js";
import { DisbursementRepository } from "./disbursement.repository.js";
import type { CreateDisbursementInput, ListQuery, UpdateStatusInput } from "./disbursement.schema.js";
import { buildCsv } from "./disbursement.export.js";

export interface Actor {
  id: string;
  username: string;
  role: UserRole;
}

export interface CreateResult {
  disbursement: DisbursementApi;
  statusCode: number;
  replayed: boolean;
}

export interface StatusUpdateResult {
  disbursement: DisbursementApi;
  replayed: boolean;
}

export type DisbursementApi = ReturnType<typeof toApiDisbursement>;

/**
 * Drizzle returns rows keyed by the schema property names (camelCase). The API
 * contract exposes snake_case fields, so map rows at the service boundary.
 * This also guarantees the idempotency-replay body matches the original wire
 * response exactly.
 */
export function toApiDisbursement(d: Disbursement) {
  return {
    id: d.id,
    recipient_name: d.recipientName,
    account_number: d.accountNumber,
    bank_code: d.bankCode,
    amount: d.amount,
    admin_fee: d.adminFee,
    note: d.note ?? null,
    status: d.status,
    created_by: d.createdBy,
    approved_by: d.approvedBy ?? null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    deleted_at: d.deletedAt ?? null,
  };
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Deterministic normalization so payload comparison is stable across key order. */
export function hashRequestPayload(input: CreateDisbursementInput): string {
  const normalized = {
    recipient_name: input.recipient_name,
    account_number: input.account_number,
    bank_code: input.bank_code,
    amount: input.amount,
    note: input.note ?? null,
  };
  return sha256(JSON.stringify(normalized));
}

/** Deterministic normalization of a status-transition request (id + payload). */
export function hashStatusPayload(id: string, input: UpdateStatusInput): string {
  const normalized = {
    id,
    status: input.status,
    note: input.note ?? null,
  };
  return sha256(JSON.stringify(normalized));
}

export class DisbursementService {
  constructor(
    private readonly db: Db,
    private readonly repo: DisbursementRepository,
    private readonly audit: AuditLogService,
  ) {}

  async list(actor: Actor, query: ListQuery) {
    void actor; // any authenticated role may list
    validateDateFilter(query.date_from, "date_from");
    validateDateFilter(query.date_to, "date_to");
    const { rows, total } = await this.repo.list(query);
    return {
      rows: rows.map(toApiDisbursement),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        total_pages: Math.ceil(total / query.limit),
      },
    };
  }

  /**
   * CSV export of the rows matching the same filters as the list endpoint.
   * Excel-compatible: UTF-8 BOM, RFC 4180 quoting, CRLF line endings.
   */
  async exportCsv(actor: Actor, query: ListQuery): Promise<{ csv: string; filename: string }> {
    void actor; // any authenticated role may export (same as list)
    const rows = await this.repo.listForExport(query);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return { csv: buildCsv(rows), filename: `disbursements-${stamp}.csv` };
  }

  async getById(id: string): Promise<DisbursementApi> {
    const row = await this.repo.findById(id);
    if (!row) throw errors.notFound("Disbursement not found.");
    return toApiDisbursement(row);
  }

  async create(
    actor: Actor,
    input: CreateDisbursementInput,
    idempotencyKey: string | undefined,
    requestId: string,
    log: FastifyBaseLogger,
  ): Promise<CreateResult> {
    if (!canCreateDisbursement(actor.role)) throw errors.forbidden();

    if (!idempotencyKey) {
      const disbursement = await this.createRow(actor, input);
      await this.auditCreated(toApiDisbursement(disbursement), actor, requestId, log);
      return { disbursement: toApiDisbursement(disbursement), statusCode: 201, replayed: false };
    }

    const requestHash = hashRequestPayload(input);

    // Fast path: replay an already-completed key without taking a lock.
    const existing = await this.findIdempotencyKey(actor.id, idempotencyKey);
    if (existing) return this.replayOrConflict(existing.requestHash === requestHash, existing);

    // Slow path: transaction-scoped advisory lock serializes concurrent first-use.
    return this.db.transaction(async (tx) => {
      await tx.execute(
        // Lock key derived from (user_id, idempotency_key); xact lock releases on commit.
        sql`SELECT pg_advisory_xact_lock(hashtext(${actor.id}), hashtext(${idempotencyKey}))`,
      );

      const insideRows = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, actor.id),
            eq(idempotencyKeys.idempotencyKey, idempotencyKey),
            gt(idempotencyKeys.expiresAt, new Date()),
          ),
        )
        .limit(1);
      const inside = insideRows[0];
      if (inside) {
        return this.replayOrConflict(inside.requestHash === requestHash, inside);
      }

      // An expired row still occupies the (user_id, idempotency_key) unique
      // slot, so a fresh insert would violate the constraint. Replace it here,
      // inside the advisory lock, so expired keys are genuinely reusable.
      await tx
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, actor.id),
            eq(idempotencyKeys.idempotencyKey, idempotencyKey),
            lte(idempotencyKeys.expiresAt, new Date()),
          ),
        );

      const repo = new DisbursementRepository(tx as unknown as Db);
      const disbursement = await repo.create({
        recipientName: input.recipient_name,
        accountNumber: input.account_number,
        bankCode: input.bank_code,
        amount: input.amount,
        adminFee: calculateAdminFee(input.amount),
        note: input.note,
        createdBy: actor.id,
      });

      const responseBody = { success: true, data: toApiDisbursement(disbursement) };
      await tx.insert(idempotencyKeys).values({
        userId: actor.id,
        idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody,
        resourceId: disbursement.id,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });

      return { disbursement: toApiDisbursement(disbursement), statusCode: 201 as const, replayed: false };
    }).then(async (result) => {
      // Audit write happens after the primary transaction commits (non-blocking).
      if (!result.replayed) {
        await this.auditCreated(result.disbursement, actor, requestId, log);
      }
      return result;
    });
  }

  /**
   * All-or-nothing batch create. The route schema already validates every item
   * (and the 1-100 length bound); inserts share one transaction so a failure
   * rolls back the whole batch. Audit entries are written after commit, one per
   * disbursement, with the same non-blocking semantics as single create.
   * Idempotency-Key is intentionally not supported for batch.
   */
  async createBatch(
    actor: Actor,
    items: CreateDisbursementInput[],
    requestId: string,
    log: FastifyBaseLogger,
  ): Promise<{ created: number; items: DisbursementApi[] }> {
    if (!canCreateDisbursement(actor.role)) throw errors.forbidden();
    if (items.length < 1 || items.length > 100) {
      throw errors.badRequest(
        "VALIDATION_ERROR",
        "Batch must contain between 1 and 100 items.",
      );
    }

    const created = await this.db.transaction(async (tx) => {
      const repo = new DisbursementRepository(tx as unknown as Db);
      const rows: Disbursement[] = [];
      for (const item of items) {
        rows.push(
          await repo.create({
            recipientName: item.recipient_name,
            accountNumber: item.account_number,
            bankCode: item.bank_code,
            amount: item.amount,
            adminFee: calculateAdminFee(item.amount),
            note: item.note,
            createdBy: actor.id,
          }),
        );
      }
      return rows;
    });

    const apiItems = created.map(toApiDisbursement);
    for (const disbursement of created) {
      await this.auditCreated(toApiDisbursement(disbursement), actor, requestId, log);
    }
    return { created: created.length, items: apiItems };
  }

  private replayOrConflict(
    hashMatches: boolean,
    existing: { responseStatus: number; responseBody: unknown },
  ): CreateResult {
    if (!hashMatches) {
      throw errors.conflict(
        "IDEMPOTENCY_KEY_REUSED",
        "The idempotency key was already used with a different request payload.",
      );
    }
    const body = existing.responseBody as { data: DisbursementApi };
    return { disbursement: body.data, statusCode: existing.responseStatus, replayed: true };
  }

  private async findIdempotencyKey(userId: string, key: string) {
    const rows = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.idempotencyKey, key),
          gt(idempotencyKeys.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async createRow(actor: Actor, input: CreateDisbursementInput): Promise<Disbursement> {
    return this.repo.create({
      recipientName: input.recipient_name,
      accountNumber: input.account_number,
      bankCode: input.bank_code,
      amount: input.amount,
      adminFee: calculateAdminFee(input.amount),
      note: input.note,
      createdBy: actor.id,
    });
  }

  private async auditCreated(d: DisbursementApi, actor: Actor, requestId: string, log: FastifyBaseLogger) {
    await this.audit.record(
      {
        entityId: d.id,
        action: "created",
        actorId: actor.id,
        actorUsername: actor.username,
        before: null,
        after: d,
        requestId,
      },
      log,
    );
  }

  async updateStatus(
    actor: Actor,
    id: string,
    input: UpdateStatusInput,
    idempotencyKey: string | undefined,
    requestId: string,
    log: FastifyBaseLogger,
  ): Promise<StatusUpdateResult> {
    if (!canChangeStatus(actor.role)) throw errors.forbidden();

    if (!idempotencyKey) {
      return this.transition(actor, id, input, requestId, log);
    }

    const requestHash = hashStatusPayload(id, input);

    // Fast path: replay an already-completed key without taking a lock.
    const existing = await this.findIdempotencyKey(actor.id, idempotencyKey);
    if (existing) {
      return this.replayStatusOrConflict(existing.requestHash === requestHash, existing);
    }

    // Slow path: transaction-scoped advisory lock serializes concurrent
    // first-use, mirroring the create flow. The CAS transition and the
    // idempotency row commit atomically, so a replayed key can never replay a
    // transition that did not actually win.
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${actor.id}), hashtext(${idempotencyKey}))`,
      );

      const insideRows = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, actor.id),
            eq(idempotencyKeys.idempotencyKey, idempotencyKey),
            gt(idempotencyKeys.expiresAt, new Date()),
          ),
        )
        .limit(1);
      const inside = insideRows[0];
      if (inside) {
        return this.replayStatusOrConflict(inside.requestHash === requestHash, inside);
      }

      // An expired row still occupies the (user_id, idempotency_key) unique
      // slot, so replace it here, inside the advisory lock.
      await tx
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, actor.id),
            eq(idempotencyKeys.idempotencyKey, idempotencyKey),
            lte(idempotencyKeys.expiresAt, new Date()),
          ),
        );

      const repo = new DisbursementRepository(tx as unknown as Db);
      const before = await repo.findRawById(id);
      const updated = await repo.transitionStatus(id, input.status, actor.id, input.note);
      if (!updated) {
        if (!before || before.deletedAt) throw errors.notFound("Disbursement not found.");
        throw errors.conflict(
          "DISBURSEMENT_NOT_PENDING",
          "Only pending disbursements can be updated.",
        );
      }

      const responseBody = { success: true, data: toApiDisbursement(updated) };
      await tx.insert(idempotencyKeys).values({
        userId: actor.id,
        idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody,
        resourceId: updated.id,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });

      return { updated, before };
    }).then(async (result) => {
      if ("replayed" in result) return result;
      // Audit write happens after the primary transaction commits (non-blocking).
      await this.auditStatusChanged(result.before, result.updated, actor, requestId, log);
      return { disbursement: toApiDisbursement(result.updated), replayed: false };
    });
  }

  /** Non-idempotent status transition: read, CAS, disambiguate, audit. */
  private async transition(
    actor: Actor,
    id: string,
    input: UpdateStatusInput,
    requestId: string,
    log: FastifyBaseLogger,
  ): Promise<StatusUpdateResult> {
    const before = await this.repo.findRawById(id);
    const updated = await this.repo.transitionStatus(id, input.status, actor.id, input.note);

    if (!updated) {
      if (!before || before.deletedAt) throw errors.notFound("Disbursement not found.");
      throw errors.conflict(
        "DISBURSEMENT_NOT_PENDING",
        "Only pending disbursements can be updated.",
      );
    }

    await this.auditStatusChanged(before, updated, actor, requestId, log);
    return { disbursement: toApiDisbursement(updated), replayed: false };
  }

  private async auditStatusChanged(
    before: Disbursement | undefined,
    updated: Disbursement,
    actor: Actor,
    requestId: string,
    log: FastifyBaseLogger,
  ) {
    await this.audit.record(
      {
        entityId: updated.id,
        action: "status_changed",
        actorId: actor.id,
        actorUsername: actor.username,
        before: before ? { status: before.status, note: before.note } : null,
        after: { status: updated.status, note: updated.note, approved_by: updated.approvedBy },
        requestId,
      },
      log,
    );
  }

  private replayStatusOrConflict(
    hashMatches: boolean,
    existing: { responseStatus: number; responseBody: unknown },
  ): StatusUpdateResult {
    if (!hashMatches) {
      throw errors.conflict(
        "IDEMPOTENCY_KEY_REUSED",
        "The idempotency key was already used with a different request payload.",
      );
    }
    const body = existing.responseBody as { data: DisbursementApi };
    return { disbursement: body.data, replayed: true };
  }

  async softDelete(
    actor: Actor,
    id: string,
    requestId: string,
    log: FastifyBaseLogger,
  ): Promise<DisbursementApi> {
    if (!canDeleteDisbursement(actor.role)) throw errors.forbidden();

    const before = await this.repo.findRawById(id);
    const deleted = await this.repo.softDelete(id);

    if (!deleted) {
      if (!before || before.deletedAt) throw errors.notFound("Disbursement not found.");
      throw errors.conflict(
        "DISBURSEMENT_NOT_PENDING",
        "Only pending disbursements can be deleted.",
      );
    }

    await this.audit.record(
      {
        entityId: id,
        action: "deleted",
        actorId: actor.id,
        actorUsername: actor.username,
        before: { status: before?.status, deleted_at: before?.deletedAt ?? null },
        after: { deleted_at: deleted.deletedAt },
        requestId,
      },
      log,
    );
    return toApiDisbursement(deleted);
  }
}
