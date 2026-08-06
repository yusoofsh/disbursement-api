import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const USER_ROLES = ["superadmin", "admin", "operator"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DISBURSEMENT_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 64 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: varchar("role", { length: 16 }).notNull().$type<UserRole>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_unique").on(t.username),
    check("users_role_check", sql`${t.role} IN ('superadmin', 'admin', 'operator')`),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_token_hash_unique").on(t.tokenHash),
    index("refresh_tokens_user_id_idx").on(t.userId),
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

export const disbursements = pgTable(
  "disbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientName: varchar("recipient_name", { length: 255 }).notNull(),
    accountNumber: varchar("account_number", { length: 64 }).notNull(),
    bankCode: varchar("bank_code", { length: 16 }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    adminFee: integer("admin_fee").notNull(),
    note: text("note"),
    status: varchar("status", { length: 16 }).notNull().default("PENDING").$type<DisbursementStatus>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("disbursements_amount_min", sql`${t.amount} >= 10000`),
    check("disbursements_admin_fee_check", sql`${t.adminFee} IN (2500, 5000)`),
    check("disbursements_status_check", sql`${t.status} IN ('PENDING', 'APPROVED', 'REJECTED')`),
    index("disbursements_status_created_idx")
      .on(t.status, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index("disbursements_created_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    index("disbursements_amount_idx").on(t.amount).where(sql`${t.deletedAt} IS NULL`),
    index("disbursements_created_by_idx").on(t.createdBy),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    resourceId: uuid("resource_id").references(() => disbursements.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("idempotency_keys_user_key_unique").on(t.userId, t.idempotencyKey),
    index("idempotency_keys_expires_at_idx").on(t.expiresAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    actorId: uuid("actor_id"),
    actorUsername: varchar("actor_username", { length: 64 }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: uuid("request_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityId, t.createdAt.desc()),
    index("audit_logs_action_idx").on(t.action, t.createdAt.desc()),
    index("audit_logs_created_idx").on(t.createdAt.desc()),
  ],
);

export type User = typeof users.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type Disbursement = typeof disbursements.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
