import type { FastifyBaseLogger } from "fastify";
import { validateDateFilter } from "../../shared/utils/date-filter.js";
import type { AuditLogEntry, AuditLogQuery, AuditLogRepository } from "./audit-log.repository.js";

export class AuditLogService {
  constructor(private readonly repo: AuditLogRepository) {}

  /**
   * Non-blocking audit write: failures are logged as structured server errors
   * and never propagate to the caller. Trade-off documented in ARCHITECTURE.md.
   */
  async record(entry: AuditLogEntry, log: FastifyBaseLogger): Promise<void> {
    try {
      await this.repo.insert(entry);
    } catch (err) {
      log.error(
        {
          err,
          request_id: entry.requestId,
          entity_id: entry.entityId,
          action: entry.action,
        },
        "audit log write failed; primary operation unaffected",
      );
    }
  }

  async list(query: AuditLogQuery) {
    validateDateFilter(query.date_from, "date_from");
    validateDateFilter(query.date_to, "date_to");
    return this.repo.list(query);
  }
}
