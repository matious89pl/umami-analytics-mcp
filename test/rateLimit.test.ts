import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BACKOFF,
  SlidingWindowLimiter,
  backoffMs,
  parseRetryAfter,
} from "../src/umami/rateLimit";

afterEach(() => vi.useRealTimers());

describe("backoffMs", () => {
  it("grows exponentially and caps at maxMs", () => {
    expect(backoffMs(0, DEFAULT_BACKOFF)).toBe(500);
    expect(backoffMs(1, DEFAULT_BACKOFF)).toBe(1000);
    expect(backoffMs(2, DEFAULT_BACKOFF)).toBe(2000);
    expect(backoffMs(10, DEFAULT_BACKOFF)).toBe(8000); // capped
  });

  it("honors an explicit Retry-After delay", () => {
    expect(backoffMs(0, DEFAULT_BACKOFF, 3000)).toBe(3000);
    expect(backoffMs(0, DEFAULT_BACKOFF, 999_999)).toBe(8000); // still capped
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds", () => {
    expect(parseRetryAfter("2")).toBe(2000);
  });

  it("parses an HTTP date relative to now", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const future = new Date(now + 5000).toUTCString();
    expect(parseRetryAfter(future, now)).toBe(5000);
  });

  it("returns undefined for missing/garbage", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("SlidingWindowLimiter", () => {
  it("admits up to max immediately, then waits for the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = new SlidingWindowLimiter(2, 1000);

    await limiter.acquire();
    await limiter.acquire();

    let third = false;
    const pending = limiter.acquire().then(() => {
      third = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(third).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(third).toBe(true);
  });
});
