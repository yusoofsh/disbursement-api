import { describe, expect, it } from "vitest";
import { hashRequestPayload } from "../../src/modules/disbursements/disbursement.service.js";

describe("idempotency request hash", () => {
  const base = {
    recipient_name: "Budi Santoso",
    account_number: "1234567890",
    bank_code: "BCA",
    amount: 1_250_000,
    note: "Pembayaran supplier",
  };

  it("is stable regardless of JSON key order", () => {
    const shuffled = {
      amount: base.amount,
      note: base.note,
      recipient_name: base.recipient_name,
      bank_code: base.bank_code,
      account_number: base.account_number,
    };
    expect(hashRequestPayload(base)).toBe(hashRequestPayload(shuffled));
  });

  it("distinguishes payloads that differ in any field", () => {
    expect(hashRequestPayload(base)).not.toBe(hashRequestPayload({ ...base, amount: 5_000_000 }));
    expect(hashRequestPayload(base)).not.toBe(hashRequestPayload({ ...base, note: "other" }));
    expect(hashRequestPayload(base)).not.toBe(
      hashRequestPayload({ ...base, account_number: "0987654321" }),
    );
  });

  it("normalizes missing, undefined and null note to the same hash", () => {
    const withoutNote = { ...base } as typeof base & { note?: string };
    delete withoutNote.note;
    expect(hashRequestPayload(withoutNote)).toBe(
      hashRequestPayload({ ...base, note: undefined as unknown as string }),
    );
    expect(hashRequestPayload(withoutNote)).toBe(
      hashRequestPayload({ ...base, note: null as unknown as string }),
    );
    expect(hashRequestPayload(withoutNote)).not.toBe(
      hashRequestPayload({ ...base, note: "a note" }),
    );
  });
});
