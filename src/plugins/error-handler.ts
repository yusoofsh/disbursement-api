import fp from "fastify-plugin";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../shared/errors/app-error.js";
import { failure } from "../shared/http/response.js";

export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(failure(error.code, error.message));
    }
    // Fastify validation errors (from JSON schema) carry statusCode 400.
    if ("statusCode" in error && error.statusCode === 400) {
      return reply
        .status(400)
        .send(failure("VALIDATION_ERROR", error.message ?? "The request is invalid."));
    }
    if ("statusCode" in error && typeof error.statusCode === "number" && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send(failure(error.code ?? "REQUEST_ERROR", error.message));
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.status(500).send(failure("INTERNAL_ERROR", "An unexpected error occurred."));
  });

  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send(failure("ROUTE_NOT_FOUND", "The requested route does not exist."));
  });
});
