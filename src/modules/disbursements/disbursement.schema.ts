import { z } from "zod";
import {
  disbursementObject,
  errorResponses,
  paginationMeta,
} from "../../shared/http/openapi-schemas.js";

const singleDisbursementResponse = {
  type: "object",
  properties: {
    success: { type: "boolean", enum: [true] },
    data: disbursementObject,
  },
} as const;

export const createDisbursementBodySchema = z.object({
  recipient_name: z.string().min(1).max(255),
  account_number: z.string().min(1).max(64),
  bank_code: z.string().min(1).max(16),
  amount: z.number().int().positive().min(10000),
  note: z.string().max(2000).optional(),
});

/** Shared item shape for single and batch create (Fastify JSON schema). */
const disbursementItemProperties = {
  recipient_name: { type: "string", minLength: 1, maxLength: 255 },
  account_number: { type: "string", minLength: 1, maxLength: 64 },
  bank_code: { type: "string", minLength: 1, maxLength: 16 },
  amount: { type: "integer", minimum: 10000 },
  note: { type: "string", maxLength: 2000 },
} as const;

const disbursementItemRequired = ["recipient_name", "account_number", "bank_code", "amount"] as const;

export const createDisbursementJsonSchema = {
  tags: ["disbursements"],
  summary: "Create a disbursement",
  description:
    "Creates a PENDING disbursement with a computed admin fee. Supports an optional Idempotency-Key header (UUID v4); a reused key replays the stored response for 24 hours.",
  security: [{ bearerAuth: [] }],
  response: {
    201: { description: "Created (or replayed) disbursement", ...singleDisbursementResponse },
    400: errorResponses[400],
    401: errorResponses[401],
    409: errorResponses[409],
    429: errorResponses[429],
  },
  headers: {
    type: "object",
    properties: {
      "idempotency-key": {
        type: "string",
        description:
          "Optional UUID v4 (validated in the route handler, which returns 400 INVALID_IDEMPOTENCY_KEY otherwise). Reusing the same key with the same payload within 24 hours replays the stored response without creating a second disbursement.",
      },
    },
  },
  body: {
    type: "object",
    required: disbursementItemRequired,
    additionalProperties: false,
    properties: disbursementItemProperties,
  },
} as const;

export const createBatchJsonSchema = {
  tags: ["disbursements"],
  summary: "Create disbursements in batch",
  description:
    "Creates 1-100 disbursements atomically in one transaction. Each item follows the single-create rules and gets its own admin fee. Idempotency-Key is not supported for batch requests.",
  security: [{ bearerAuth: [] }],
  response: {
    201: {
      description: "Created batch",
      type: "object",
      properties: {
        success: { type: "boolean", enum: [true] },
        data: {
          type: "object",
          properties: {
            created: { type: "integer" },
            items: { type: "array", items: disbursementObject },
          },
        },
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    429: errorResponses[429],
  },
  body: {
    type: "object",
    required: ["items"],
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "object",
          required: disbursementItemRequired,
          additionalProperties: false,
          properties: disbursementItemProperties,
        },
      },
    },
  },
} as const;

export const updateStatusJsonSchema = {
  tags: ["disbursements"],
  summary: "Update disbursement status",
  description:
    "Transitions a PENDING disbursement to APPROVED or REJECTED. Concurrency-safe: only one concurrent transition wins; losers receive 409.",
  security: [{ bearerAuth: [] }],
  response: {
    200: { description: "Updated disbursement", ...singleDisbursementResponse },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    429: errorResponses[429],
  },
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
  tags: ["disbursements"],
  security: [{ bearerAuth: [] }],
  response: {
    200: { description: "The disbursement (GET only)", ...singleDisbursementResponse },
    204: { description: "Soft-deleted (DELETE only)", type: "null" },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
    429: errorResponses[429],
  },
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
} as const;

export const listQueryJsonSchema = {
  tags: ["disbursements"],
  summary: "List disbursements",
  description:
    "Paginated list with search, status/date filters and sorting. Excludes soft-deleted records.",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      description: "Paginated disbursements",
      type: "object",
      properties: {
        success: { type: "boolean", enum: [true] },
        data: { type: "array", items: disbursementObject },
        meta: paginationMeta,
      },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    429: errorResponses[429],
  },
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
