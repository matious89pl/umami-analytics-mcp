import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { resolveDateRange, type ResolvedRange } from "../umami/dates";
import type { UmamiContext } from "../server";
import { fail } from "../util/output";

/** MCP tool annotations (hints clients use to warn/badge tools). */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolMeta<S extends z.ZodRawShape, O extends z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema?: S;
  outputSchema?: O;
  annotations?: ToolAnnotations;
}

/** Output type of a Zod raw shape (the validated args object). */
export type ArgsOf<S extends z.ZodRawShape> = { [K in keyof S]: z.infer<S[K]> };

/**
 * Register a tool with a centralized error boundary: thrown errors (incl.
 * UmamiApiError) become redacted `isError` results instead of protocol faults,
 * so the model can read and react to them. Preserves arg typing from the schema.
 */
export function reg<S extends z.ZodRawShape, O extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  meta: ToolMeta<S, O>,
  handler: (args: ArgsOf<S>, extra: unknown) => Promise<CallToolResult> | CallToolResult,
): void {
  server.registerTool(
    name,
    meta as never,
    (async (args: unknown, extra: unknown) => {
      try {
        return await handler(args as ArgsOf<S>, extra);
      } catch (err) {
        return fail(err);
      }
    }) as never,
  );
}

// ── Shared input schema fragments ────────────────────────────────────────────

export const websiteIdShape = {
  websiteId: z.string().min(1).describe("Umami website UUID (obtain from list_websites)."),
} as const;

export const dateRangeShape = {
  range: z
    .string()
    .optional()
    .describe(
      'Relative window: "24h", "7d", "30d", "12w", "today", "yesterday", "this-week", "last-month", "this-year". Ignored when startAt/endAt are set. Default "7d".',
    ),
  startAt: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Explicit start — ISO 8601, YYYY-MM-DD, or epoch milliseconds. Overrides range."),
  endAt: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Explicit end — ISO 8601, YYYY-MM-DD, or epoch milliseconds. Defaults to now."),
} as const;

export const timezoneShape = {
  timezone: z
    .string()
    .optional()
    .describe("IANA timezone for bucketing (e.g. America/New_York). Defaults to the server's configured tz."),
} as const;

export const paginationShape = {
  page: z.number().int().positive().optional().describe("1-based page number."),
  pageSize: z.number().int().positive().max(200).optional().describe("Results per page (max 200)."),
  search: z.string().optional().describe("Substring filter."),
} as const;

/** Filters accepted by stats/metrics endpoints, passed through as query params. */
export const filterShape = {
  url: z.string().optional(),
  referrer: z.string().optional(),
  title: z.string().optional(),
  query: z.string().optional(),
  event: z.string().optional(),
  host: z.string().optional(),
  os: z.string().optional(),
  browser: z.string().optional(),
  device: z.string().optional(),
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  language: z.string().optional(),
  tag: z.string().optional(),
} as const;

// ── Shared helpers ───────────────────────────────────────────────────────────

export interface RangeArgs {
  range?: string;
  startAt?: string | number;
  endAt?: string | number;
}

export function resolveRange(args: RangeArgs): ResolvedRange {
  return resolveDateRange(args);
}

export function tzOf(ctx: UmamiContext, timezone?: string): string {
  return timezone ?? ctx.defaults.timezone;
}

/** Unwrap a list response that may be a bare array or `{ data, count }`. */
export function asList<T = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && Array.isArray((res as { data?: unknown }).data)) {
    return (res as { data: T[] }).data;
  }
  return [];
}

export function asCount(res: unknown, fallback: number): number {
  if (res && typeof res === "object" && typeof (res as { count?: unknown }).count === "number") {
    return (res as { count: number }).count;
  }
  return fallback;
}

/** Build only the defined filter params (drops undefined) for a query string. */
export function pickFilters(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(filterShape)) {
    const v = args[key];
    if (typeof v === "string" && v !== "") out[key] = v;
  }
  return out;
}
