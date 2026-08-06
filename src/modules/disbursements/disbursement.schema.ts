import { z } from "zod";

export const createDisbursementBodySchema = z.object({
  recipient_name: z.string().min(1).max(255),
  account_number: z.string().min(1).max(64),
  bank_code: z.string().min(1).max(16),
  amount: z.number().int().positive().min(10000),
  note: z.string().max(2000).optional(),
});

export const createDisbursementJsonSchema = {
  body: {
    type: "object",
    required: ["recipient_name", "account_number", "bank_code", "amount"],
    additionalProperties: false,
    properties: {
      recipient_name: { type: "string", minLength: 1, maxLength: 255 },
      account_number: { type: "string", minLength: 1, maxLength: 64 },
      bank_code: { type: "string", minLength: 1, maxLength: 16 },
      amount: { type: "integer", minimum: 10000 },
      note: { type: "string", maxLength: 2000 },
    },
  },
} as const;

export const updateStatusJsonSchema = {
  body: {
    type: "object",
    required: ["status"],
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["APPROVED", "REJECTED"] },
      note: { type: "string", maxLength: 2000 },
    },
  },
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
} as const;

export const idParamJsonSchema = {
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
} as const;

export const listQueryJsonSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      search: { type: "string", maxLength: 255 },
      status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
      date_from: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
      date_to: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$" },
      sort_by: { type: "string", enum: ["created_at", "amount"], default: "created_at" },
      sort_order: { type: "string", enum: ["asc", "desc"], default: "desc" },
    },
  },
} as const;

export interface ListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  date_from?: string;
  date_to?: string;
  sort_by: "created_at" | "amount";
  sort_order: "asc" | "desc";
}

export interface CreateDisbursementInput {
  recipient_name: string;
  account_number: string;
  bank_code: string;
  amount: number;
  note?: string;
}

export interface UpdateStatusInput {
  status: "APPROVED" | "REJECTED";
  note?: string;
}
