import { describe, expect, it } from "vitest";

import { msToSeconds, parseInstant, resolveDateRange } from "../src/umami/dates";
import { UmamiInputError } from "../src/umami/errors";

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0); // 2026-06-30T12:00:00Z
const DAY = 86_400_000;

describe("parseInstant", () => {
  it("parses ISO strings and dates", () => {
    expect(parseInstant("2026-06-30")).toBe(Date.UTC(2026, 5, 30));
    expect(parseInstant("2026-06-30T12:00:00Z")).toBe(NOW);
  });

  it("parses numeric strings and numbers as epoch ms", () => {
    expect(parseInstant("1700000000000")).toBe(1_700_000_000_000);
    expect(parseInstant(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("throws on garbage", () => {
    expect(() => parseInstant("not-a-date")).toThrow(UmamiInputError);
    expect(() => parseInstant("")).toThrow(UmamiInputError);
  });
});

describe("msToSeconds", () => {
  it("truncates ms to seconds", () => {
    expect(msToSeconds(1_700_000_000_123)).toBe(1_700_000_000);
  });
});

describe("resolveDateRange", () => {
  it("honors explicit start/end over range", () => {
    const r = resolveDateRange({ startAt: "2026-06-01", endAt: "2026-06-30", range: "7d" }, NOW);
    expect(r.startAt).toBe(Date.UTC(2026, 5, 1));
    expect(r.endAt).toBe(Date.UTC(2026, 5, 30));
  });

  it("defaults end to now and start to 7d before", () => {
    const r = resolveDateRange({ startAt: NOW - DAY }, NOW);
    expect(r.endAt).toBe(NOW);
    expect(r.startAt).toBe(NOW - DAY);
  });

  it("resolves relative presets", () => {
    expect(resolveDateRange({ range: "7d" }, NOW)).toEqual({ startAt: NOW - 7 * DAY, endAt: NOW });
    expect(resolveDateRange({ range: "24h" }, NOW)).toEqual({ startAt: NOW - DAY, endAt: NOW });
    expect(resolveDateRange({ range: "today" }, NOW)).toEqual({
      startAt: Date.UTC(2026, 5, 30),
      endAt: NOW,
    });
  });

  it("defaults to last 7 days when nothing is given", () => {
    expect(resolveDateRange(undefined, NOW)).toEqual({ startAt: NOW - 7 * DAY, endAt: NOW });
  });

  it("rejects inverted ranges and unknown presets", () => {
    expect(() => resolveDateRange({ startAt: NOW, endAt: NOW - DAY }, NOW)).toThrow(UmamiInputError);
    expect(() => resolveDateRange({ range: "fortnight" }, NOW)).toThrow(UmamiInputError);
  });
});
