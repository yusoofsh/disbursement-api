import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { success } from "../../shared/http/response.js";
import { errors } from "../../shared/errors/app-error.js";
import type { AccessTokenPayload } from "../../plugins/auth.js";
import {
  createBatchJsonSchema,
  createDisbursementJsonSchema,
  exportQueryJsonSchema,
  idParamJsonSchema,
  listQueryJsonSchema,
  updateStatusJsonSchema,
  type CreateDisbursementInput,
  type ListQuery,
  type UpdateStatusInput,
} from "./disbursement.schema.js";
import type { Actor, DisbursementService } from "./disbursement.service.js";

const idempotencyKeySchema = z.string().uuid();

/** Map the JWT payload (sub claim) onto the service Actor contract. */
function toActor(user: AccessTokenPayload): Actor {
  return { id: user.sub, username: user.username, role: user.role };
}

export function disbursementRoutes(
  service: DisbursementService,
  opts: { rateLimitCreateMax: number },
) {
  return async function routes(app: FastifyInstance) {
    app.addHook("preHandler", app.authenticate);

    app.get("/disbursements", { schema: listQueryJsonSchema }, async (request, reply) => {
      const query = request.query as ListQuery;
      const { rows, meta } = await service.list(toActor(request.user), query);
      return reply.send(success(rows, meta));
    });

    app.get("/disbursements/:id", { schema: idParamJsonSchema }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const row = await service.getById(id);
      return reply.send(success(row));
    });

    app.get("/disbursements/export", { schema: exportQueryJsonSchema }, async (request, reply) => {
      const query = request.query as ListQuery;
      const { csv, filename } = await service.exportCsv(toActor(request.user), query);
      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(csv);
    });

    app.post(
      "/disbursements",
      { schema: createDisbursementJsonSchema, config: { rateLimit: { max: opts.rateLimitCreateMax } } },
      async (request, reply) => {
        const rawKey = request.headers["idempotency-key"];
        let idempotencyKey: string | undefined;
        if (rawKey !== undefined) {
          const parsed = idempotencyKeySchema.safeParse(rawKey);
          if (!parsed.success) {
            throw errors.badRequest("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be a valid UUID v4.");
          }
          idempotencyKey = parsed.data;
        }
        const result = await service.create(
          toActor(request.user),
          request.body as CreateDisbursementInput,
          idempotencyKey,
          request.id,
          request.log,
        );
        reply.header("X-Idempotent-Replayed", result.replayed ? "true" : "false");
        return reply.status(result.statusCode as 201).send(success(result.disbursement));
      },
    );

    app.post(
      "/disbursements/batch",
      { schema: createBatchJsonSchema, config: { rateLimit: { max: opts.rateLimitCreateMax } } },
      async (request, reply) => {
        const { items } = request.body as { items: CreateDisbursementInput[] };
        const result = await service.createBatch(toActor(request.user), items, request.id, request.log);
        return reply.status(201).send(success(result));
      },
    );

    app.patch(
      "/disbursements/:id/status",
      { schema: updateStatusJsonSchema, preHandler: app.requireRole("admin", "superadmin") },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const updated = await service.updateStatus(
          toActor(request.user),
          id,
          request.body as UpdateStatusInput,
          request.id,
          request.log,
        );
        return reply.send(success(updated));
      },
    );

    app.delete(
      "/disbursements/:id",
      { schema: idParamJsonSchema, preHandler: app.requireRole("superadmin") },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const deleted = await service.softDelete(toActor(request.user), id, request.id, request.log);
        return reply.send(success(deleted));
      },
    );
  };
}
