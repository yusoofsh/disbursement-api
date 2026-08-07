import { and, count, desc, asc, eq, gte, ilike, isNull, lte, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { disbursements, type Disbursement, type DisbursementStatus } from "../../db/schema.js";
import type { ListQuery } from "./disbursement.schema.js";

export interface CreateDisbursementRow {
  recipientName: string;
  accountNumber: string;
  bankCode: string;
  amount: number;
  adminFee: number;
  note?: string;
  createdBy: string;
}

export class DisbursementRepository {
  constructor(private readonly db: Db) {}

  async create(row: CreateDisbursementRow): Promise<Disbursement> {
    const rows = await this.db.insert(disbursements).values(row).returning();
    return rows[0]!;
  }

  async findById(id: string): Promise<Disbursement | undefined> {
    const rows = await this.db
      .select()
      .from(disbursements)
      .where(and(eq(disbursements.id, id), isNull(disbursements.deletedAt)))
      .limit(1);
    return rows[0];
  }

  async list(query: ListQuery): Promise<{ rows: Disbursement[]; total: number }> {
    const conditions: SQL[] = [isNull(disbursements.deletedAt)];
    if (query.search) conditions.push(ilike(disbursements.recipientName, `%${query.search}%`));
    if (query.status) conditions.push(eq(disbursements.status, query.status));
    if (query.date_from) conditions.push(gte(disbursements.createdAt, new Date(`${query.date_from}T00:00:00.000Z`)));
    if (query.date_to) conditions.push(lte(disbursements.createdAt, new Date(`${query.date_to}T23:59:59.999Z`)));
    const where = and(...conditions);

    const sortColumn = query.sort_by === "amount" ? disbursements.amount : disbursements.createdAt;
    const orderBy = query.sort_order === "asc" ? asc(sortColumn) : desc(sortColumn);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(disbursements)
        .where(where)
        .orderBy(orderBy)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ value: count() }).from(disbursements).where(where),
    ]);
    return { rows, total: totalRows[0]?.value ?? 0 };
  }

  /** All rows matching the list filters (no pagination) for CSV export. */
  async listForExport(query: ListQuery): Promise<Disbursement[]> {
    const conditions: SQL[] = [isNull(disbursements.deletedAt)];
    if (query.search) conditions.push(ilike(disbursements.recipientName, `%${query.search}%`));
    if (query.status) conditions.push(eq(disbursements.status, query.status));
    if (query.date_from) conditions.push(gte(disbursements.createdAt, new Date(`${query.date_from}T00:00:00.000Z`)));
    if (query.date_to) conditions.push(lte(disbursements.createdAt, new Date(`${query.date_to}T23:59:59.999Z`)));
    const where = and(...conditions);
    const sortColumn = query.sort_by === "amount" ? disbursements.amount : disbursements.createdAt;
    const orderBy = query.sort_order === "asc" ? asc(sortColumn) : desc(sortColumn);
    return this.db.select().from(disbursements).where(where).orderBy(orderBy);
  }

  /**
   * Atomic compare-and-set status transition. Returns the updated row when the
   * record was still PENDING; returns no row when it was missing, soft-deleted,
   * or already terminal. Callers disambiguate with a follow-up lookup.
   */
  async transitionStatus(
    id: string,
    status: Exclude<DisbursementStatus, "PENDING">,
    approvedBy: string,
    note: string | undefined,
  ): Promise<Disbursement | undefined> {
    const rows = await this.db
      .update(disbursements)
      .set({
        status,
        approvedBy,
        updatedAt: new Date(),
        ...(note !== undefined ? { note } : {}),
      })
      .where(
        and(
          eq(disbursements.id, id),
          eq(disbursements.status, "PENDING"),
          isNull(disbursements.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }

  async softDelete(id: string): Promise<Disbursement | undefined> {
    const rows = await this.db
      .update(disbursements)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(disbursements.id, id),
          eq(disbursements.status, "PENDING"),
          isNull(disbursements.deletedAt),
        ),
      )
      .returning();
    return rows[0];
  }

  /** Includes soft-deleted rows; used for 404-vs-409 disambiguation. */
  async findRawById(id: string): Promise<Disbursement | undefined> {
    const rows = await this.db.select().from(disbursements).where(eq(disbursements.id, id)).limit(1);
    return rows[0];
  }
}
