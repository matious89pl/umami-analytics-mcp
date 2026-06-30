import { describe, expect, it } from "vitest";

import { checkBearer, extractBearer } from "../src/http/auth";

describe("extractBearer", () => {
  it("extracts the token (case-insensitive scheme)", () => {
    expect(extractBearer("Bearer abc123")).toBe("abc123");
    expect(extractBearer("bearer abc123")).toBe("abc123");
  });

  it("returns undefined for missing or non-bearer headers", () => {
    expect(extractBearer(null)).toBeUndefined();
    expect(extractBearer(undefined)).toBeUndefined();
    expect(extractBearer("Basic xyz")).toBeUndefined();
    expect(extractBearer("")).toBeUndefined();
  });
});

describe("checkBearer", () => {
  it("accepts an exact match", () => {
    expect(checkBearer("super-secret", "super-secret")).toBe(true);
  });

  it("rejects a mismatch of equal length", () => {
    expect(checkBearer("super-secrXt", "super-secret")).toBe(false);
  });

  it("rejects length differences without throwing", () => {
    expect(checkBearer("a", "super-secret")).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    expect(checkBearer("anything", undefined)).toBe(false);
    expect(checkBearer("anything", "")).toBe(false);
  });

  it("rejects when no token is presented", () => {
    expect(checkBearer(undefined, "super-secret")).toBe(false);
  });
});
