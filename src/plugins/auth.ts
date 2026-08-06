import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../config/env.js";
import type { UserRole } from "../db/schema.js";
import { errors } from "../shared/errors/app-error.js";

export interface AccessTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp<{ env: Env }>(async (app: FastifyInstance, opts: { env: Env }) => {
  await app.register(jwt, {
    secret: opts.env.JWT_ACCESS_SECRET,
    sign: { expiresIn: opts.env.JWT_ACCESS_TTL },
  });

  app.decorate("authenticate", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw errors.unauthorized();
    }
  });

  app.decorate("requireRole", (...roles: UserRole[]) => {
    return async (request: FastifyRequest) => {
      try {
        await request.jwtVerify();
      } catch {
        throw errors.unauthorized();
      }
      if (!roles.includes(request.user.role)) {
        throw errors.forbidden();
      }
    };
  });
});

// nub's store layout does not link the `fastify` peer into @fastify/jwt's
// package directory, so its `declare module "fastify"` augmentation is not
// loaded by TypeScript. Restore the request API we rely on here using the
// package's own exported types, so the declarations merge cleanly when the
// package's augmentation IS loaded (pnpm layout, CI).
declare module "fastify" {
  interface FastifyRequest {
    jwtVerify: import("@fastify/jwt").JwtVerifyFunction;
    user: import("@fastify/jwt").UserType;
  }
}
