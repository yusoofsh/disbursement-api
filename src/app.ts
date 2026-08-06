import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import type { Env } from "./config/env.js";
import { createDb } from "./db/client.js";
import { AuditLogRepository } from "./modules/audit-logs/audit-log.repository.js";
import { auditLogRoutes } from "./modules/audit-logs/audit-log.routes.js";
import { AuditLogService } from "./modules/audit-logs/audit-log.service.js";
import { AuthRepository } from "./modules/auth/auth.repository.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { DisbursementRepository } from "./modules/disbursements/disbursement.repository.js";
import { disbursementRoutes } from "./modules/disbursements/disbursement.routes.js";
import { DisbursementService } from "./modules/disbursements/disbursement.service.js";
import { authPlugin } from "./plugins/auth.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { failure, success } from "./shared/http/response.js";

export type App = FastifyInstance;

export async function buildApp(env: Env): Promise<App> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Fastify binds reqId per request; keep it in every JSON log line.
      serializers: {
        reqId: (reqId: unknown): string => String(reqId),
      },
    },
    genReqId: () => crypto.randomUUID(),
    trustProxy: false,
  });

  // Correlate every response (including errors) with the request id.
  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Request-ID", request.id);
  });

  const { db, pool } = createDb(env.DATABASE_URL);
  app.addHook("onClose", async () => {
    await pool.end();
  });

  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { env });

  const authRepository = new AuthRepository(db);
  const authService = new AuthService(authRepository, env);
  const auditLogRepository = new AuditLogRepository(db);
  const auditLogService = new AuditLogService(auditLogRepository);
  const disbursementRepository = new DisbursementRepository(db);
  const disbursementService = new DisbursementService(db, disbursementRepository, auditLogService);

  await app.register(authRoutes(authService));
  await app.register(disbursementRoutes(disbursementService));
  await app.register(auditLogRoutes(auditLogService));

  app.get("/health", async (request, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return reply.send(success({ status: "ok" }));
    } catch (err) {
      request.log.error({ err }, "health check failed");
      return reply
        .status(503)
        .send(failure("DATABASE_UNAVAILABLE", "The database is unavailable."));
    }
  });

  return app;
}
