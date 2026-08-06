import { z } from "zod";

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
  body: {
    type: "object",
    required: ["refresh_token"],
    additionalProperties: false,
    properties: {
      refresh_token: { type: "string", minLength: 1 },
    },
  },
} as const;
