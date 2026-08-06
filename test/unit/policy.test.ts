import { describe, expect, it } from "vitest";
import {
  canChangeStatus,
  canCreateDisbursement,
  canDeleteDisbursement,
} from "../../src/modules/disbursements/disbursement.policy.js";
import type { UserRole } from "../../src/db/schema.js";

const ROLES: UserRole[] = ["superadmin", "admin", "operator"];

const expectedMatrix: Record<UserRole, { create: boolean; changeStatus: boolean; delete: boolean }> = {
  superadmin: { create: true, changeStatus: true, delete: true },
  admin: { create: true, changeStatus: true, delete: false },
  operator: { create: true, changeStatus: false, delete: false },
};

describe("disbursement role permission matrix", () => {
  for (const role of ROLES) {
    it(`${role}: create=${expectedMatrix[role].create}, changeStatus=${expectedMatrix[role].changeStatus}, delete=${expectedMatrix[role].delete}`, () => {
      expect(canCreateDisbursement(role)).toBe(expectedMatrix[role].create);
      expect(canChangeStatus(role)).toBe(expectedMatrix[role].changeStatus);
      expect(canDeleteDisbursement(role)).toBe(expectedMatrix[role].delete);
    });
  }

  it("operator cannot change status", () => {
    expect(canChangeStatus("operator")).toBe(false);
  });

  it("operator cannot delete", () => {
    expect(canDeleteDisbursement("operator")).toBe(false);
  });

  it("admin cannot delete", () => {
    expect(canDeleteDisbursement("admin")).toBe(false);
  });

  it("superadmin can do everything", () => {
    expect(canCreateDisbursement("superadmin")).toBe(true);
    expect(canChangeStatus("superadmin")).toBe(true);
    expect(canDeleteDisbursement("superadmin")).toBe(true);
  });
});
