import { describe, expect, it } from "vitest";
import { calculateAdminFee } from "../../src/modules/disbursements/disbursement.policy.js";
import {
  createDisbursementBodySchema,
  MAX_AMOUNT,
} from "../../src/modules/disbursements/disbursement.schema.js";

const validBody = {
  recipient_name: "Budi Santoso",
  account_number: "1234567890",
  bank_code: "BCA",
  amount: 1_250_000,
  note: "Pembayaran supplier",
};

describe("calculateAdminFee", () => {
  it("charges 2500 below the 5,000,000 threshold", () => {
    expect(calculateAdminFee(10_000)).toBe(2500);
    expect(calculateAdminFee(4_999_999)).toBe(2500);
  });

  it("charges 5000 at and above the 5,000,000 threshold", () => {
    expect(calculateAdminFee(5_000_000)).toBe(5000);
    expect(calculateAdminFee(5_000_001)).toBe(5000);
  });
});

describe("createDisbursementBodySchema", () => {
  it("rejects amounts below the 10,000 minimum", () => {
    const result = createDisbursementBodySchema.safeParse({ ...validBody, amount: 9_999 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer amounts", () => {
    const result = createDisbursementBodySchema.safeParse({ ...validBody, amount: 12_500.5 });
    expect(result.success).toBe(false);
  });

  it("accepts the maximum safe integer amount", () => {
    const result = createDisbursementBodySchema.safeParse({ ...validBody, amount: MAX_AMOUNT });
    expect(result.success).toBe(true);
  });

  it("rejects amounts beyond the lossless BIGINT->number range", () => {
    const result = createDisbursementBodySchema.safeParse({ ...validBody, amount: MAX_AMOUNT + 1 });
    expect(result.success).toBe(false);
  });
});
