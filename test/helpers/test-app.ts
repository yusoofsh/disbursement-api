import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { expect } from "vitest";
import { buildApp, type App } from "../../src/app.js";
import { loadEnv, type Env } from "../../src/config/env.js";
import { createDb } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seed } from "../../src/db/seed.js";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/disbursement";

export const SEED_USERS = {
  superadmin: { username: "superadmin", password: "superadmin123" },
  admin: { username: "admin", password: "admin123" },
  operator: { username: "operator", password: "operator123" },
} as const;

export type SeedRole = keyof typeof SEED_USERS;

export type InjectResponse = Awaited<ReturnType<App["inject"]>>;

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

let migrationsApplied = false;

/** Migrate once per worker, then wipe all tables and re-seed the three users. */
export async function resetDatabase(): Promise<void> {
  if (!migrationsApplied) {
    await runMigrations(TEST_DATABASE_URL);
    migrationsApplied = true;
  }
  const { db, pool } = createDb(TEST_DATABASE_URL);
  try {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, idempotency_keys, disbursements, refresh_tokens, users RESTART IDENTITY CASCADE`,
    );
    await seed(db);
  } finally {
    await pool.end();
  }
}

export function getTestEnv(): Env {
  return loadEnv(process.env);
}

export async function createTestApp(): Promise<App> {
  return buildApp(getTestEnv());
}

export function expectRequestId(res: InjectResponse): void {
  const requestId = res.headers["x-request-id"];
  expect(typeof requestId).toBe("string");
  expect(String(requestId).length).toBeGreaterThan(0);
}

export async function inject(app: App, options: Parameters<App["inject"]>[0]): Promise<InjectResponse> {
  const res = await app.inject(options);
  expectRequestId(res);
  return res;
}

export async function loginAs(app: App, role: SeedRole): Promise<TokenPair> {
  const { username, password } = SEED_USERS[role];
  const res = await inject(app, {
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().data as TokenPair;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function decodeSub(token: string): string {
  const payload = jwt.decode(token) as { sub: string };
  return payload.sub;
}

export function createDisbursementPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipient_name: "Budi Santoso",
    account_number: "1234567890",
    bank_code: "BCA",
    amount: 1_250_000,
    note: "Pembayaran supplier",
    ...overrides,
  };
}

export async function createDisbursement(
  app: App,
  token: string,
  overrides: Record<string, unknown> = {},
  idempotencyKey?: string,
): Promise<InjectResponse> {
  return inject(app, {
    method: "POST",
    url: "/disbursements",
    headers: {
      ...bearer(token),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    payload: createDisbursementPayload(overrides),
  });
}

export async function countRows(table: "disbursements" | "idempotency_keys" | "audit_logs"): Promise<number> {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  try {
    const rows = await db.execute(sql.raw(`SELECT count(*)::int AS count FROM ${table}`));
    return (rows.rows[0] as { count: number }).count;
  } finally {
    await pool.end();
  }
}

export async function countWhere(
  table: "disbursements" | "idempotency_keys",
  column: "recipient_name" | "idempotency_key",
  value: string,
): Promise<number> {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  try {
    const rows = await db.execute(
      sql.raw(`SELECT count(*)::int AS count FROM ${table} WHERE ${column} = '${value}'`),
    );
    return (rows.rows[0] as { count: number }).count;
  } finally {
    await pool.end();
  }
}

export async function countAuditLogs(
  action: "created" | "status_changed" | "deleted",
  entityId?: string,
): Promise<number> {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  try {
    const rows = await db.execute(
      sql.raw(
        `SELECT count(*)::int AS count FROM audit_logs WHERE action = '${action}'` +
          (entityId ? ` AND entity_id = '${entityId}'` : ""),
      ),
    );
    return (rows.rows[0] as { count: number }).count;
  } finally {
    await pool.end();
  }
}
