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

/**
 * Reports are POST-with-body **reads**. Umami v3 expects:
 *   { websiteId, type, filters, parameters: { startDate, endDate, ...specific } }
 * where startDate/endDate are ISO strings inside `parameters`. The write tier is
 * not required for these.
 */
export function registerReportReadTools(server: McpServer, ctx: UmamiContext): void {
  const isoRange = (args: { range?: string; startAt?: string | number; endAt?: string | number }) => {
    const { startAt, endAt } = resolveRange(args);
    return { startDate: new Date(startAt).toISOString(), endDate: new Date(endAt).toISOString() };
  };

  const runReport = (
    type: string,
    websiteId: string,
    parameters: Record<string, unknown>,
    filters: Record<string, string> = {},
  ) => ctx.umami.post<unknown>(`/reports/${type}`, { websiteId, type, filters, parameters });

  reg(
    server,
    "report_funnel",
    {
      title: "Funnel report",
      description:
        "Conversion funnel across an ordered list of steps. Each step is { type: 'path' | 'event', value }. `window` is the conversion window (hours).",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        steps: z
          .array(z.object({ type: z.enum(["path", "url", "event"]), value: z.string() }))
          .min(2)
          .max(8)
          .describe("Ordered funnel steps (2–8). Use type 'event' for custom events, 'path' for URLs."),
        window: z.number().int().positive().optional().describe("Conversion window in hours (default 24)."),
        ...filterShape,
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await runReport(
        "funnel",
        args.websiteId,
        {
          ...isoRange(args),
          window: args.window ?? 24,
          steps: args.steps.map((s) => ({ type: s.type === "url" ? "path" : s.type, value: s.value })),
        },
        pickFilters(args),
      );
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
      const data = await runReport("retention", args.websiteId, {
        ...isoRange(args),
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
      description: "Most common navigation paths through the site, up to `steps` deep (2–7). Optionally pin a start or end step.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        steps: z.number().int().min(2).max(7).optional().describe("Path depth (default 5)."),
        startStep: z.string().optional().describe("Pin the first URL/path or event."),
        endStep: z.string().optional().describe("Pin the final URL/path or event."),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await runReport("journey", args.websiteId, {
        ...isoRange(args),
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
      description:
        "Progress toward one or more goals. Each goal is { type: 'event' | 'path', value }. Computed per goal against Umami's /reports/goal endpoint.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        goals: z
          .array(z.object({ type: z.enum(["event", "path", "url"]), value: z.string() }))
          .min(1)
          .describe("Goal definitions, e.g. { type: 'event', value: 'export_completed' }."),
        ...filterShape,
      },
      outputSchema: { data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const range = isoRange(args);
      const filters = pickFilters(args);
      const results = [];
      for (const g of args.goals) {
        const type = g.type === "url" ? "path" : g.type;
        const data = await runReport("goal", args.websiteId, { ...range, type, value: g.value }, filters);
        results.push({ goal: { type, value: g.value }, result: data });
      }
      return ok({ data: results }, `Goals report for ${args.goals.length} goal(s).`);
    },
  );

  reg(
    server,
    "report_attribution",
    {
      title: "Attribution report",
      description: "Conversion attribution. `model` is first-click or last-click; `type` is the target dimension; `step` the target value.",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        model: z.enum(["first-click", "last-click"]).describe("Attribution model."),
        type: z.enum(["path", "event"]).describe("Target dimension."),
        step: z.string().describe("Target value (the conversion)."),
        currency: z.string().optional(),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await runReport("attribution", args.websiteId, {
        ...isoRange(args),
        model: args.model,
        type: args.type,
        step: args.step,
        currency: args.currency,
      });
      return ok({ data }, `Attribution (${args.model}) computed.`);
    },
  );

  reg(
    server,
    "report_revenue",
    {
      title: "Revenue report",
      description: "Revenue analytics over the period (requires revenue events configured in Umami). `currency` is required (e.g. USD).",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        ...timezoneShape,
        currency: z.string().describe("ISO currency code, e.g. USD."),
        unit: z.enum(["minute", "hour", "day", "month", "year"]).optional(),
        compare: z.enum(["prev", "yoy"]).optional(),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await runReport("revenue", args.websiteId, {
        ...isoRange(args),
        timezone: tzOf(ctx, args.timezone),
        currency: args.currency,
        unit: args.unit,
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
      const data = await runReport("utm", args.websiteId, { ...isoRange(args) }, pickFilters(args));
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
      const data = await runReport(
        "breakdown",
        args.websiteId,
        { ...isoRange(args), fields: args.fields },
        pickFilters(args),
      );
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
        metric: z.enum(["lcp", "inp", "cls", "fcp", "ttfb"]).optional(),
        unit: z.enum(["minute", "hour", "day", "month", "year"]).optional(),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await runReport("performance", args.websiteId, {
        ...isoRange(args),
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
      description: "List saved reports (funnels, goals, journeys, etc.), optionally scoped to a website.",
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
      const count = asCount(res, data.length);
      const summary = data.length
        ? `${num(count)} saved report(s):\n` +
          data
            .slice(0, 25)
            .map((r) => `• [${(r as { type?: string }).type ?? "?"}] ${(r as { name?: string }).name ?? "(unnamed)"}`)
            .join("\n")
        : "No saved reports.";
      return ok({ count, data }, summary);
    },
  );

  reg(
    server,
    "get_report",
    {
      title: "Get saved report",
      description: "Fetch a saved report's full definition (type, parameters) by ID.",
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
