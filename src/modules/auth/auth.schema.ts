import { z } from "zod";
import { errorResponses, tokenPairResponse } from "../../shared/http/openapi-schemas.js";

export const loginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const refreshBodySchema = z.object({
  refresh_token: z.string().min(1),
});

export const logoutBodySchema = z.object({
  refresh_token: z.string().min(1),
});

export const loginJsonSchema = {
  tags: ["auth"],
  summary: "Login",
  description: "Authenticates with username and password, returning access and refresh tokens.",
  response: {
    200: { description: "Token pair", ...tokenPairResponse },
    400: errorResponses[400],
    401: errorResponses[401],
    429: errorResponses[429],
  },
  body: {
    type: "object",
    required: ["username", "password"],
    additionalProperties: false,
    properties: {
      username: { type: "string", minLength: 1 },
      password: { type: "string", minLength: 1 },
    },
  },
} as const;

export const refreshJsonSchema = {
  tags: ["auth"],
  summary: "Refresh token rotation",
  description: "Rotates the presented refresh token and issues a fresh token pair.",
  response: {
    200: { description: "Fresh token pair", ...tokenPairResponse },
    400: errorResponses[400],
    401: errorResponses[401],
    429: errorResponses[429],
  },
  body: {
    type: "object",
    required: ["refresh_token"],
    additionalProperties: false,
    properties: {
      refresh_token: { type: "string", minLength: 1 },
    },
  },
} as const;

export const logoutJsonSchema = {
  tags: ["auth"],
  summary: "Logout",
  description: "Revokes the presented refresh token; subsequent use fails with 401.",
  response: {
    200: {
      description: "Logout confirmation",
      type: "object",
      properties: {
        success: { type: "boolean", enum: [true] },
        data: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    429: errorResponses[429],
  },
  body: {
    type: "object",
    required: ["refresh_token"],
    additionalProperties: false,
    properties: {
      refresh_token: { type: "string", minLength: 1 },
    },
  },
} as const;
