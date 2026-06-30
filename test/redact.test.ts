import { afterEach, describe, expect, it } from "vitest";

import { redact, redactString, registerSecret, resetSecrets } from "../src/util/redact";

afterEach(() => resetSecrets());

describe("redactString", () => {
  it("masks registered secret literals", () => {
    registerSecret("super-secret-token");
    expect(redactString("auth=super-secret-token done")).toBe("auth=[redacted] done");
  });

  it("ignores trivially short secrets", () => {
    registerSecret("ab");
    expect(redactString("value ab")).toBe("value ab");
  });

  it("leaves unrelated strings untouched", () => {
    registerSecret("xyzq-secret");
    expect(redactString("nothing here")).toBe("nothing here");
  });
});

describe("redact", () => {
  it("masks sensitive keys regardless of value", () => {
    const out = redact({
      password: "p4ssw0rd",
      apiKey: "k",
      authorization: "Bearer abc",
      "x-umami-api-key": "k2",
      keep: "visible",
    });
    expect(out).toEqual({
      password: "[redacted]",
      apiKey: "[redacted]",
      authorization: "[redacted]",
      "x-umami-api-key": "[redacted]",
      keep: "visible",
    });
  });

  it("recurses into nested objects and arrays", () => {
    registerSecret("leaked-value-123");
    const out = redact({
      user: { name: "ok", token: "t" },
      list: [{ password: "x" }, "carrying leaked-value-123 here"],
    });
    expect(out).toEqual({
      user: { name: "ok", token: "[redacted]" },
      list: [{ password: "[redacted]" }, "carrying [redacted] here"],
    });
  });

  it("does not mutate the input", () => {
    const input = { token: "t", nested: { password: "p" } };
    const snapshot = structuredClone(input);
    redact(input);
    expect(input).toEqual(snapshot);
  });

  it("passes through primitives", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(true)).toBe(true);
  });
});
