import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { redactString } from "./redact";

/**
 * Build a successful tool result: a human-readable text summary plus the full
 * structured payload (token-efficient — the summary is what the model reads at a
 * glance, `structuredContent` carries the complete data for precise follow-ups).
 */
export function ok(structuredContent: Record<string, unknown>, summary: string): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent,
  };
}

/** Build an error result (redacted). Returned as `isError` so the model sees it. */
export function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${redactString(message)}` }],
    isError: true,
  };
}

/** Truncate a list for display, appending an ellipsis note when clipped. */
export function clip<T>(rows: readonly T[], limit: number): { shown: T[]; more: number } {
  if (rows.length <= limit) return { shown: [...rows], more: 0 };
  return { shown: rows.slice(0, limit), more: rows.length - limit };
}

/** Format a number compactly (e.g. 12,345). */
export function num(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : String(value ?? "—");
}

/** Extract a number from either a bare number or a `{ value }` wrapper (Umami
 * stats fields appear in both shapes across versions). */
export function pluckNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

/** Sum the `y` field across a `{ x, y }[]` time series. */
export function sumSeries(series: unknown): number {
  if (!Array.isArray(series)) return 0;
  return series.reduce((acc: number, row) => {
    const y = (row as { y?: unknown })?.y;
    return acc + (typeof y === "number" ? y : 0);
  }, 0);
}
