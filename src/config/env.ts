import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_CREATE_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  CORS_ORIGIN: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim())
    .refine((value) => value === "" || value === "*" || value.split(",").every((o) => /^https?:\/\/[^\s,]+$/.test(o.trim())), {
      message: "CORS_ORIGIN must be '*', empty, or a comma-separated list of http(s) origins",
    }),
  // Public base URL advertised in the OpenAPI `servers` field. When empty the
  // field is omitted and Swagger UI falls back to the page origin, which is
  // correct for both local dev (localhost) and the live Cloudflare-hosted docs.
  PUBLIC_URL: z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim())
    .refine((value) => value === "" || /^https?:\/\/[^\s]+$/.test(value), {
      message: "PUBLIC_URL must be empty or an http(s) URL",
    }),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
