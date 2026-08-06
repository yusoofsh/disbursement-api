import type { FastifyInstance } from "fastify";
import { success } from "../../shared/http/response.js";
import type { AuditLog } from "../../db/schema.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { AuditLogQuery } from "./audit-log.repository.js";

const auditLogQueryJsonSchema = {
  tags: ["audit-logs"],
  summary: "List audit logs",
  description: "Paginated audit trail with entity_id, action and date filters. Superadmin only.",
  security: [{ bearerAuth: [] }],
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      entity_id: { type: "string", format: "uuid" },
      action: { type: "string", enum: ["created", "status_changed", "deleted"] },
      date_from: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
      date_to: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
    },
  },
} as const;

/** Map Drizzle rows (camelCase) onto the documented snake_case API shape. */
function toApiAuditLog(row: AuditLog) {
  return {
    id: row.id,
    entity_id: row.entityId,
    action: row.action,
    actor_id: row.actorId,
    actor_username: row.actorUsername,
    before: row.before,
    after: row.after,
    request_id: row.requestId,
    created_at: row.createdAt,
  };
}

export function auditLogRoutes(service: AuditLogService) {
  return async function routes(app: FastifyInstance) {
    app.get(
      "/audit-logs",
      { schema: auditLogQueryJsonSchema, preHandler: app.requireRole("superadmin") },
      async (request, reply) => {
        const query = request.query as AuditLogQuery;
        const { rows, total } = await service.list(query);
        return reply.send(
          success(rows.map(toApiAuditLog), {
            page: query.page,
            limit: query.limit,
            total,
            total_pages: Math.ceil(total / query.limit),
          }),
        );
      },
    );
  };
}
