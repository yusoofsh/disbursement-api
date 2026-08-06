import type { UserRole } from "../../db/schema.js";

export function calculateAdminFee(amount: number): 2500 | 5000 {
  return amount < 5_000_000 ? 2500 : 5000;
}

export function canCreateDisbursement(role: UserRole): boolean {
  return role === "operator" || role === "admin" || role === "superadmin";
}

export function canChangeStatus(role: UserRole): boolean {
  return role === "admin" || role === "superadmin";
}

export function canDeleteDisbursement(role: UserRole): boolean {
  return role === "superadmin";
}
