import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { auditLogs, type AuditLog } from "../../db/schema.js";

export interface AuditLogEntry {
  entityId: string;
  action: "created" | "status_changed" | "deleted";
  actorId: string | null;
  actorUsername: string;
  before: unknown;
  after: unknown;
  requestId: string;
}

export interface AuditLogQuery {
  page: number;
  limit: number;
  entity_id?: string;
  action?: string;
  date_from?: string;
  date_to?: string;
}

export class AuditLogRepository {
  constructor(private readonly db: Db) {}

  async insert(entry: AuditLogEntry): Promise<AuditLog> {
    const rows = await this.db.insert(auditLogs).values(entry).returning();
    return rows[0]!;
  }

  async list(query: AuditLogQuery): Promise<{ rows: AuditLog[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.entity_id) conditions.push(eq(auditLogs.entityId, query.entity_id));
    if (query.action) conditions.push(eq(auditLogs.action, query.action));
    if (query.date_from) conditions.push(gte(auditLogs.createdAt, new Date(`${query.date_from}T00:00:00.000Z`)));
    if (query.date_to) conditions.push(lte(auditLogs.createdAt, new Date(`${query.date_to}T23:59:59.999Z`)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ value: count() }).from(auditLogs).where(where),
    ]);
    return { rows, total: totalRows[0]?.value ?? 0 };
  }
}
