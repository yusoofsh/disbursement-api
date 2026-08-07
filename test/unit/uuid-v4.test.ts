import { describe, expect, it } from "vitest";
import { isUuidV4 } from "../../src/shared/utils/uuid.js";

describe("isUuidV4", () => {
  it("accepts valid v4 UUIDs (including uppercase)", () => {
    expect(isUuidV4("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuidV4("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
    expect(isUuidV4("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
  });

  it("rejects other UUID versions", () => {
    // v1 (time-based), v3 (md5), v5 (sha1), v7 (timestamp), nil UUID.
    expect(isUuidV4("7d444840-9dc0-11d1-b15a-00c04fc304eb")).toBe(false);
    expect(isUuidV4("6fa459ea-ee8a-3ca4-894e-db77e160355e")).toBe(false);
    expect(isUuidV4("886313e1-3b8a-5372-9b90-0c9aee199e5d")).toBe(false);
    expect(isUuidV4("017f22e2-79b0-7cc3-98c4-dc0c0c07398f")).toBe(false);
    expect(isUuidV4("00000000-0000-0000-0000-000000000000")).toBe(false);
  });

  it("rejects malformed values", () => {
    expect(isUuidV4("")).toBe(false);
    expect(isUuidV4("not-a-uuid")).toBe(false);
    expect(isUuidV4("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
    expect(isUuidV4("550e8400-e29b-41d4-a716-4466554400000")).toBe(false);
    expect(isUuidV4("550e8400e29b41d4a716446655440000")).toBe(false);
    // v4 shape but wrong variant nibble.
    expect(isUuidV4("550e8400-e29b-41d4-0716-446655440000")).toBe(false);
  });
});
