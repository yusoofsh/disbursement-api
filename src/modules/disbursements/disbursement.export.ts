import type { Disbursement } from "../../db/schema.js";

/**
 * RFC 4180 CSV serialization with a UTF-8 BOM so Excel opens the file with
 * correct character encoding. Every field is quoted and embedded quotes are
 * doubled — safe for any note/name content.
 */
export const EXPORT_COLUMNS = [
  "id",
  "recipient_name",
  "account_number",
  "bank_code",
  "amount",
  "admin_fee",
  "status",
  "note",
  "created_by",
  "approved_by",
  "created_at",
  "updated_at",
] as const;

function csvField(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

export function toCsvRow(disbursement: Disbursement): string {
  return [
    csvField(disbursement.id),
    csvField(disbursement.recipientName),
    csvField(disbursement.accountNumber),
    csvField(disbursement.bankCode),
    csvField(disbursement.amount),
    csvField(disbursement.adminFee),
    csvField(disbursement.status),
    csvField(disbursement.note),
    csvField(disbursement.createdBy),
    csvField(disbursement.approvedBy),
    csvField(disbursement.createdAt.toISOString()),
    csvField(disbursement.updatedAt.toISOString()),
  ].join(",");
}

export function buildCsv(rows: Disbursement[]): string {
  const header = EXPORT_COLUMNS.map((c) => csvField(c)).join(",");
  const lines = [header, ...rows.map(toCsvRow)];
  // UTF-8 BOM first so Excel detects UTF-8 instead of assuming ANSI.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
