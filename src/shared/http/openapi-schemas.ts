/**
 * Shared OpenAPI response schemas. These are documentation-only (Fastify does
 * not validate responses against them unless asked to), so they describe the
 * wire contract produced by the snake_case API mappers.
 */

const errorResponse = (description: string) => ({
  description,
  type: "object",
  properties: {
    success: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
    },
  },
} as const);

export const errorResponses = {
  400: errorResponse("Validation or malformed input"),
  401: errorResponse("Missing or invalid authentication"),
  403: errorResponse("Insufficient role"),
  404: errorResponse("Resource not found"),
  409: errorResponse("Conflicting state or idempotency mismatch"),
  429: errorResponse("Rate limit exceeded"),
  500: errorResponse("Unexpected internal error"),
} as const;

export const disbursementObject = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    recipient_name: { type: "string" },
    account_number: { type: "string" },
    bank_code: { type: "string" },
    amount: { type: "integer" },
    admin_fee: { type: "integer", enum: [2500, 5000] },
    note: { type: ["string", "null"] },
    status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
    created_by: { type: "string", format: "uuid" },
    approved_by: { type: ["string", "null"], format: "uuid" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    deleted_at: { type: ["string", "null"], format: "date-time" },
  },
} as const;

export const paginationMeta = {
  type: "object",
  properties: {
    page: { type: "integer" },
    limit: { type: "integer" },
    total: { type: "integer" },
    total_pages: { type: "integer" },
  },
} as const;

export const tokenPairResponse = {
  type: "object",
  properties: {
    success: { type: "boolean", enum: [true] },
    data: {
      type: "object",
      properties: {
        access_token: { type: "string" },
        refresh_token: { type: "string" },
        token_type: { type: "string", enum: ["Bearer"] },
        expires_in: { type: "integer", description: "Access token TTL in seconds" },
      },
    },
  },
} as const;
