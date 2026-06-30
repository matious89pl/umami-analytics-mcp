import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";
import { num, ok, pluckNumber, sumSeries } from "../util/output";
import {
  dateRangeShape,
  filterShape,
  pickFilters,
  reg,
  resolveRange,
  timezoneShape,
  tzOf,
  websiteIdShape,
} from "./shared";

export function registerStatsReadTools(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "get_stats",
    {
      title: "Get website stats",
      description:
        "Aggregate metrics for a website over a date range: pageviews, visitors (unique sessions), visits, bounces (single-pageview sessions), and totaltime (seconds). Includes a previous-period `comparison` by default.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        compare: z.enum(["prev", "yoy"]).optional().describe('Comparison window: "prev" (default) or "yoy".'),
        ...filterShape,
      },
      outputSchema: { websiteId: z.string(), startAt: z.number(), endAt: z.number(), stats: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const stats = await ctx.umami.get<Record<string, unknown>>(
        `/websites/${encodeURIComponent(args.websiteId)}/stats`,
        { startAt, endAt, compare: args.compare, ...pickFilters(args) },
      );
      const pv = pluckNumber(stats["pageviews"]);
      const vs = pluckNumber(stats["visitors"]);
      const visits = pluckNumber(stats["visits"]);
      const summary = `Pageviews ${num(pv)}, visitors ${num(vs)}, visits ${num(visits)}, bounces ${num(
        pluckNumber(stats["bounces"]),
      )}, total time ${num(pluckNumber(stats["totaltime"]))}s.`;
      return ok({ websiteId: args.websiteId, startAt, endAt, stats }, summary);
    },
  );

  reg(
    server,
    "get_pageviews",
    {
      title: "Get pageviews time series",
      description:
        "Pageviews and sessions over time, bucketed by `unit`. Returns { pageviews: [{x,y}], sessions: [{x,y}] } where x is the bucket timestamp and y the count.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        unit: z
          .enum(["minute", "hour", "day", "month", "year"])
          .optional()
          .describe("Bucket size (default day)."),
        ...timezoneShape,
        ...filterShape,
      },
      outputSchema: {
        websiteId: z.string(),
        startAt: z.number(),
        endAt: z.number(),
        pageviews: z.array(z.unknown()),
        sessions: z.array(z.unknown()),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const res = await ctx.umami.get<{ pageviews?: unknown[]; sessions?: unknown[] }>(
        `/websites/${encodeURIComponent(args.websiteId)}/pageviews`,
        { startAt, endAt, unit: args.unit ?? "day", timezone: tzOf(ctx, args.timezone), ...pickFilters(args) },
      );
      const pageviews = Array.isArray(res.pageviews) ? res.pageviews : [];
      const sessions = Array.isArray(res.sessions) ? res.sessions : [];
      const summary = `${num(sumSeries(pageviews))} pageviews and ${num(
        sumSeries(sessions),
      )} sessions across ${pageviews.length} ${args.unit ?? "day"} bucket(s).`;
      return ok({ websiteId: args.websiteId, startAt, endAt, pageviews, sessions }, summary);
    },
  );

  reg(
    server,
    "get_active_visitors",
    {
      title: "Get active visitors",
      description: "Current real-time active visitor count for a website (visitors in the last few minutes).",
      inputSchema: { ...websiteIdShape },
      outputSchema: { websiteId: z.string(), visitors: z.number(), data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const res = await ctx.umami.get<unknown>(`/websites/${encodeURIComponent(args.websiteId)}/active`);
      // Umami returns either a number, { visitors }, or [{ x }].
      let visitors = 0;
      if (typeof res === "number") visitors = res;
      else if (Array.isArray(res)) visitors = pluckNumber(res[0]) ?? res.length;
      else if (res && typeof res === "object")
        visitors = pluckNumber((res as { visitors?: unknown }).visitors) ?? pluckNumber(res) ?? 0;
      return ok({ websiteId: args.websiteId, visitors, data: res }, `${num(visitors)} active visitor(s) right now.`);
    },
  );

  reg(
    server,
    "get_realtime",
    {
      title: "Get realtime activity",
      description:
        "Richer real-time snapshot for a website (recent events/sessions/series). Availability varies by Umami version; falls back gracefully.",
      inputSchema: { ...websiteIdShape },
      outputSchema: { websiteId: z.string(), data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await ctx.umami.get<unknown>(`/realtime/${encodeURIComponent(args.websiteId)}`);
      return ok({ websiteId: args.websiteId, data }, "Realtime snapshot retrieved.");
    },
  );
}
