import { errors } from "../errors/app-error.js";

/** Reject calendar-invalid YYYY-MM-DD filters (e.g. 2026-02-31) with 400. */
export function validateDateFilter(value: string | undefined, name: string): void {
  if (value === undefined) return;
  const [year, month, day] = value.split("-").map(Number);
  // Date.UTC rolls over out-of-range days (e.g. Feb 31 -> Mar 3); a
  // round-trip comparison rejects calendar-invalid dates such as 2026-02-31.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isCalendarValid =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!isCalendarValid) {
    throw errors.badRequest("INVALID_DATE", `${name} must be a valid YYYY-MM-DD date.`);
  }
}
