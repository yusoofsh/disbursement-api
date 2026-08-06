import { describe, expect, it } from "vitest";
import { buildCsv, EXPORT_COLUMNS, toCsvRow } from "../../src/modules/disbursements/disbursement.export.js";
import type { Disbursement } from "../../src/db/schema.js";

function makeDisbursement(overrides: Partial<Disbursement> = {}): Disbursement {
  const now = new Date("2026-08-06T10:00:00.000Z");
  return {
    id: "8f2a10c3-4dd7-4b8e-9b51-2a1f7b1c3d4e",
    recipientName: "Budi Santoso",
    accountNumber: "1234567890",
    bankCode: "BCA",
    amount: 1_250_000,
    adminFee: 2500,
    note: null,
    status: "PENDING",
    createdBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    approvedBy: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as Disbursement;
}

describe("CSV export serializer", () => {
  it("prepends a UTF-8 BOM so Excel reads UTF-8", () => {
    const csv = buildCsv([makeDisbursement()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith("\uFEFF\"id\"")).toBe(true);
  });

  it("emits the documented column header in order", () => {
    const csv = buildCsv([]);
    const header = csv.replace(/^\uFEFF/, "").split("\r\n")[0];
    const columns = [...header.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(columns).toEqual([...EXPORT_COLUMNS]);
  });

  it("renders a row with fee, amount, status and ISO dates", () => {
    const line = toCsvRow(makeDisbursement());
    const fields = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
    expect(fields[4]).toBe("1250000");
    expect(fields[5]).toBe("2500");
    expect(fields[6]).toBe("PENDING");
    expect(fields[10]).toBe("2026-08-06T10:00:00.000Z");
    expect(fields[11]).toBe("2026-08-06T10:00:00.000Z");
  });

  it("quotes and escapes commas, quotes and newlines inside fields", () => {
    const row = makeDisbursement({ note: 'He said "hi", ok\nline2', recipientName: "PT. A, B & C" });
    const line = toCsvRow(row);
    // The raw line must wrap embedded quotes as "" and keep commas inside quotes.
    expect(line).toContain('"He said ""hi"", ok\nline2"');
    expect(line).toContain('"PT. A, B & C"');
    // Round-trip check: re-parse keeps the original values.
    const fields = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
    expect(fields[1]).toBe("PT. A, B & C");
    expect(fields[7]).toBe('He said "hi", ok\nline2');
  });

  it("renders null fields as empty quoted cells", () => {
    const line = toCsvRow(makeDisbursement({ note: null, approvedBy: null }));
    expect(line).toContain('"PENDING",""');
    const fields = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1]);
    expect(fields[7]).toBe("");
    expect(fields[9]).toBe("");
  });

  it("uses CRLF line endings and ends with a trailing newline", () => {
    const csv = buildCsv([makeDisbursement()]);
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
