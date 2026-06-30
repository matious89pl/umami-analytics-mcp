import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";
import { num, ok } from "../util/output";
import {
  asCount,
  asList,
  dateRangeShape,
  filterShape,
  paginationShape,
  pickFilters,
  reg,
  resolveRange,
  timezoneShape,
  tzOf,
  websiteIdShape,
} from "./shared";

/** Reports are POST-with-body **reads** — they compute analytics without
 * mutating anything. The write-tier is not required for these. */
export function registerReportReadTools(server: McpServer, ctx: UmamiContext): void {
  const post = (kind: string, body: Record<string, unknown>) =>
    ctx.umami.post<unknown>(`/reports/${kind}`, body);

  reg(
    server,
    "report_funnel",
    {
      title: "Funnel report",
      description:
        "Conversion funnel across an ordered list of steps. Each step is { type: 'url' | 'event', value }. `window` is the conversion window in hours.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        steps: z
          .array(z.object({ type: z.enum(["url", "event"]), value: z.string() }))
          .min(2)
          .describe("Ordered funnel steps (≥2)."),
        window: z.number().int().positive().optional().describe("Conversion window in hours (default 24)."),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("funnel", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        steps: args.steps,
        window: args.window ?? 24,
      });
      return ok({ data }, `Funnel over ${args.steps.length} steps computed.`);
    },
  );

  reg(
    server,
    "report_retention",
    {
      title: "Retention report",
      description: "Cohort retention over the selected period (how many users return on subsequent days).",
      inputSchema: { ...websiteIdShape, ...dateRangeShape, ...timezoneShape },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("retention", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        timezone: tzOf(ctx, args.timezone),
      });
      return ok({ data }, "Retention report computed.");
    },
  );

  reg(
    server,
    "report_journey",
    {
      title: "User journey report",
      description: "Most common navigation paths through the site, up to `steps` deep. Optionally pin a start or end step.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        steps: z.number().int().min(2).max(10).optional().describe("Path depth (default 5)."),
        startStep: z.string().optional().describe("Pin the first URL/path."),
        endStep: z.string().optional().describe("Pin the final URL/path."),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("journey", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        steps: args.steps ?? 5,
        startStep: args.startStep,
        endStep: args.endStep,
      });
      return ok({ data }, "Journey report computed.");
    },
  );

  reg(
    server,
    "report_goals",
    {
      title: "Goals report",
      description: "Progress toward goals (URL or event targets). Provide goals as { type, value, operator?, goal? } objects.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        goals: z.array(z.record(z.string(), z.unknown())).min(1).describe("Goal definitions."),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("goals", { websiteId: args.websiteId, startAt, endAt, goals: args.goals });
      return ok({ data }, `Goals report for ${args.goals.length} goal(s).`);
    },
  );

  reg(
    server,
    "report_attribution",
    {
      title: "Attribution report",
      description:
        "Conversion attribution. `model` e.g. 'firstClick' | 'lastClick'; `type` the target dimension (e.g. 'url' or 'event'); `step` the target value.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        model: z.string().describe("Attribution model, e.g. firstClick | lastClick."),
        type: z.string().describe("Target dimension, e.g. url | event."),
        step: z.string().optional().describe("Target value (the conversion)."),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("attribution", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        model: args.model,
        type: args.type,
        step: args.step,
      });
      return ok({ data }, `Attribution (${args.model}) computed.`);
    },
  );

  reg(
    server,
    "report_revenue",
    {
      title: "Revenue report",
      description: "Revenue analytics over the period (requires revenue events configured in Umami).",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        ...timezoneShape,
        currency: z.string().optional().describe("ISO currency code, e.g. USD."),
        compare: z.string().optional(),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("revenue", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        timezone: tzOf(ctx, args.timezone),
        currency: args.currency,
        compare: args.compare,
      });
      return ok({ data }, "Revenue report computed.");
    },
  );

  reg(
    server,
    "report_utm",
    {
      title: "UTM report",
      description: "Breakdown of traffic by UTM parameters (source, medium, campaign, content, term).",
      inputSchema: { ...websiteIdShape, ...dateRangeShape, ...filterShape },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("utm", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        filters: pickFilters(args),
      });
      return ok({ data }, "UTM report computed.");
    },
  );

  reg(
    server,
    "report_breakdown",
    {
      title: "Breakdown report",
      description: "Multi-dimensional breakdown across one or more fields (e.g. ['country','browser']).",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        fields: z.array(z.string()).min(1).describe("Dimensions to group by."),
        ...filterShape,
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("breakdown", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        fields: args.fields,
        filters: pickFilters(args),
      });
      return ok({ data }, `Breakdown over ${args.fields.join(", ")}.`);
    },
  );

  reg(
    server,
    "report_performance",
    {
      title: "Web-vitals performance report",
      description: "Core Web Vitals over time (LCP, INP, CLS, FCP, TTFB). `metric` selects which vital; bucket by `unit`.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        ...timezoneShape,
        metric: z.string().optional().describe("Web vital, e.g. lcp | inp | cls | fcp | ttfb."),
        unit: z.enum(["minute", "hour", "day", "month", "year"]).optional(),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await post("performance", {
        websiteId: args.websiteId,
        startAt,
        endAt,
        timezone: tzOf(ctx, args.timezone),
        metric: args.metric,
        unit: args.unit,
      });
      return ok({ data }, "Performance report computed.");
    },
  );

  reg(
    server,
    "list_reports",
    {
      title: "List saved reports",
      description: "List saved reports, optionally scoped to a website.",
      inputSchema: {
        websiteId: z.string().optional().describe("Scope to a website (optional)."),
        ...paginationShape,
      },
      outputSchema: { count: z.number(), data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const res = await ctx.umami.get<unknown>("/reports", {
        websiteId: args.websiteId,
        page: args.page,
        pageSize: args.pageSize,
        search: args.search,
      });
      const data = asList(res);
      return ok({ count: asCount(res, data.length), data }, `${num(asCount(res, data.length))} saved report(s).`);
    },
  );

  reg(
    server,
    "get_report",
    {
      title: "Get saved report",
      description: "Fetch a saved report's definition by ID.",
      inputSchema: { reportId: z.string().min(1).describe("Saved report ID.") },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await ctx.umami.get<unknown>(`/reports/${encodeURIComponent(args.reportId)}`);
      return ok({ data }, `Report ${args.reportId} retrieved.`);
    },
  );
}
