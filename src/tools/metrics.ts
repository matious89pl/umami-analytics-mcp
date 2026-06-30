import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { MetricRow } from "../umami/types";
import type { UmamiContext } from "../server";
import { asList, dateRangeShape, filterShape, pickFilters, reg, resolveRange, websiteIdShape } from "./shared";
import { num, ok } from "../util/output";

/** Metric breakdown dimensions (Umami v3 EVENT_COLUMNS + SESSION_COLUMNS + channel).
 * `url` is accepted as a friendly alias for `path`. */
const METRIC_TYPES = [
  "url",
  "path",
  "fullPath",
  "entry",
  "exit",
  "referrer",
  "domain",
  "title",
  "query",
  "event",
  "tag",
  "hostname",
  "channel",
  "browser",
  "os",
  "device",
  "screen",
  "language",
  "country",
  "region",
  "city",
  "distinctId",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
] as const;

export function registerMetricsReadTools(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "get_metrics",
    {
      title: "Get metric breakdown",
      description:
        "Top-N breakdown of a website by a single dimension (`type`) over a date range. Returns ranked { x: value, y: count } rows. Use type=event for custom-event counts. `url` is an alias for `path`.",
      inputSchema: {
        ...websiteIdShape,
        type: z.enum(METRIC_TYPES).describe("Dimension to break down by."),
        ...dateRangeShape,
        limit: z.number().int().positive().max(1000).optional().describe("Max rows (default 50)."),
        search: z.string().optional().describe("Substring filter on the dimension value."),
        ...filterShape,
      },
      outputSchema: { websiteId: z.string(), type: z.string(), count: z.number(), data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const type = args.type === "url" ? "path" : args.type;
      const res = await ctx.umami.get<unknown>(`/websites/${encodeURIComponent(args.websiteId)}/metrics`, {
        type,
        startAt,
        endAt,
        limit: args.limit ?? 50,
        search: args.search,
        ...pickFilters(args),
      });
      const rows = asList<MetricRow>(res);
      const top = rows
        .slice(0, 15)
        .map((r) => `  ${num(r.y)}  ${r.x ?? "(none)"}`)
        .join("\n");
      const summary = rows.length ? `Top ${args.type} (${rows.length} rows):\n${top}` : `No ${args.type} data in range.`;
      return ok({ websiteId: args.websiteId, type, count: rows.length, data: rows }, summary);
    },
  );

  reg(
    server,
    "get_website_values",
    {
      title: "Get distinct field values",
      description:
        "List the distinct values seen for a column over a date range — useful to discover valid filter values (e.g. all browsers or countries) before filtering other queries.",
      inputSchema: {
        ...websiteIdShape,
        type: z.enum(METRIC_TYPES).describe("Column whose distinct values to list."),
        ...dateRangeShape,
        search: z.string().optional(),
      },
      outputSchema: { websiteId: z.string(), type: z.string(), data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const type = args.type === "url" ? "path" : args.type;
      const data = await ctx.umami.get<unknown>(`/websites/${encodeURIComponent(args.websiteId)}/values`, {
        type,
        startAt,
        endAt,
        search: args.search,
      });
      const n = Array.isArray(data) ? data.length : undefined;
      return ok(
        { websiteId: args.websiteId, type, data },
        n !== undefined ? `${num(n)} distinct ${args.type} value(s).` : `Distinct ${args.type} values retrieved.`,
      );
    },
  );
}
