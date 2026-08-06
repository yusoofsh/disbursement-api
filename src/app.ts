import crypto from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
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
import { AppError } from "./shared/errors/app-error.js";
import { failure, success } from "./shared/http/response.js";

export type App = FastifyInstance;

// nub's store layout does not link the `fastify` peer into @fastify/swagger's
// package directory, so its `declare module "fastify"` augmentation is not
// loaded by TypeScript. Restore the schema fields we rely on for OpenAPI docs.
declare module "fastify" {
  interface FastifySchema {
    tags?: readonly string[];
    summary?: string;
    description?: string;
    security?: readonly { [securityLabel: string]: readonly string[] }[];
  }
}

interface RateLimitErrorContext {
  statusCode: number;
  ban: boolean;
  after: string;
  max: number;
  ttl: number;
}

/**
 * Rate-limit bucket key: authenticated requests are keyed by the JWT subject
 * (decoded, not verified — the auth plugin still rejects forged tokens in
 * preHandler), public routes fall back to the client IP. Decoding keeps the
 * limiter working at the onRequest stage, before authentication runs.
 */
function rateLimitKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const auth = Array.isArray(header) ? header[0] : header;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    try {
      const payload = jwt.decode(auth.slice("Bearer ".length)) as { sub?: string } | null;
      if (payload?.sub) return `user:${payload.sub}`;
    } catch {
      // Malformed token: fall back to IP; authentication rejects it anyway.
    }
  }
  return `ip:${request.ip}`;
}

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
  // CORS is opt-in: empty CORS_ORIGIN disables it (same-origin only).
  // The interactive demo page (served from yusoofsh.id) needs the API origin
  // listed here, e.g. CORS_ORIGIN=https://www.yusoofsh.id
  if (env.CORS_ORIGIN) {
    await app.register(cors, {
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      exposedHeaders: ["X-Request-ID", "X-Idempotent-Replayed"],
    });
  }
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    keyGenerator: rateLimitKey,
    // The plugin throws whatever this returns, so return a real AppError: the
    // shared error handler then serializes it as the standard 429 contract.
    errorResponseBuilder: (request: FastifyRequest, context: RateLimitErrorContext) => {
      request.log.warn(
        { rate_limit: { max: context.max, after: context.after } },
        "rate limit exceeded",
      );
      return new AppError(429, "RATE_LIMITED", `Rate limit exceeded, retry in ${context.after}.`);
    },
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "LintasPay Disbursement API",
        description: "Idempotent, concurrency-safe disbursement service.",
        version: "1.0.0",
      },
      servers: [{ url: "http://localhost:3000" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/documentation" });

  const authRepository = new AuthRepository(db);
  const authService = new AuthService(authRepository, env);
  const auditLogRepository = new AuditLogRepository(db);
  const auditLogService = new AuditLogService(auditLogRepository);
  const disbursementRepository = new DisbursementRepository(db);
  const disbursementService = new DisbursementService(db, disbursementRepository, auditLogService);

  await app.register(authRoutes(authService, { rateLimitLoginMax: env.RATE_LIMIT_LOGIN_MAX }));
  await app.register(
    disbursementRoutes(disbursementService, { rateLimitCreateMax: env.RATE_LIMIT_CREATE_MAX }),
  );
  await app.register(auditLogRoutes(auditLogService));

  app.get(
    "/health",
    { schema: { tags: ["health"], summary: "Health check", description: "Returns 200 when the database is reachable, 503 otherwise." } },
    async (request, reply) => {
      try {
        await db.execute(sql`SELECT 1`);
        return reply.send(success({ status: "ok" }));
      } catch (err) {
        request.log.error({ err }, "health check failed");
        return reply
          .status(503)
          .send(failure("DATABASE_UNAVAILABLE", "The database is unavailable."));
      }
    },
  );

  return app;
}
