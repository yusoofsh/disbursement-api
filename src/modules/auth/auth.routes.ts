import type { FastifyInstance } from "fastify";
import { success } from "../../shared/http/response.js";
import { loginJsonSchema, refreshJsonSchema } from "./auth.schema.js";
import type { AuthService } from "./auth.service.js";

export function authRoutes(service: AuthService) {
  return async function routes(app: FastifyInstance) {
    app.post("/auth/login", { schema: loginJsonSchema }, async (request, reply) => {
      const { username, password } = request.body as { username: string; password: string };
      const tokens = await service.login(username, password);
      return reply.status(200).send(success(tokens));
    });

    app.post("/auth/refresh", { schema: refreshJsonSchema }, async (request, reply) => {
      const { refresh_token } = request.body as { refresh_token: string };
      const tokens = await service.refresh(refresh_token);
      return reply.status(200).send(success(tokens));
    });

    app.post("/auth/logout", { schema: refreshJsonSchema }, async (request, reply) => {
      const { refresh_token } = request.body as { refresh_token: string };
      await service.logout(refresh_token);
      return reply.status(200).send(success({ message: "Logged out successfully." }));
    });
  };
}
