import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";
import { num, ok, sumSeries } from "../util/output";
import {
  dateRangeShape,
  reg,
  resolveRange,
  timezoneShape,
  tzOf,
  websiteIdShape,
} from "./shared";

export function registerEventReadTools(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "get_events",
    {
      title: "Get event activity",
      description:
        "Custom-event activity over time for a website, bucketed by `unit`. Returns a time series of event counts. For a ranked list of event names use get_metrics(type='event').",
      inputSchema: {
        ...websiteIdShape,
        ...dateRangeShape,
        unit: z.enum(["minute", "hour", "day", "month", "year"]).optional().describe("Bucket size (default day)."),
        ...timezoneShape,
      },
      outputSchema: { websiteId: z.string(), startAt: z.number(), endAt: z.number(), data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await ctx.umami.get<unknown>(`/websites/${encodeURIComponent(args.websiteId)}/events`, {
        startAt,
        endAt,
        unit: args.unit ?? "day",
        timezone: tzOf(ctx, args.timezone),
      });
      const total = sumSeries(data);
      return ok(
        { websiteId: args.websiteId, startAt, endAt, data },
        total ? `${num(total)} events across the range.` : "Event activity retrieved.",
      );
    },
  );

  reg(
    server,
    "get_event_data",
    {
      title: "Explore custom event-data",
      description:
        "Explore custom event properties. `select` chooses the view: 'events' (event names), 'fields' (all fields), 'properties' (property keys), 'values' (values for a property — pass propertyName), or 'stats' (counts). Optionally scope by eventName.",
      inputSchema: {
        ...websiteIdShape,
        select: z
          .enum(["events", "fields", "properties", "values", "stats"])
          .describe("Which event-data view to return."),
        eventName: z.string().optional().describe("Scope to a single custom event name."),
        propertyName: z.string().optional().describe("Required when select='values'."),
        ...dateRangeShape,
      },
      outputSchema: { websiteId: z.string(), select: z.string(), data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const base = `/websites/${encodeURIComponent(args.websiteId)}/event-data`;
      const map: Record<string, string> = {
        events: `${base}/events`,
        fields: `${base}/fields`,
        properties: `${base}/properties`,
        values: `${base}/values`,
        stats: `${base}/stats`,
      };
      const data = await ctx.umami.get<unknown>(map[args.select]!, {
        startAt,
        endAt,
        eventName: args.eventName,
        propertyName: args.propertyName,
      });
      const n = Array.isArray(data) ? `${data.length} row(s)` : "data";
      return ok({ websiteId: args.websiteId, select: args.select, data }, `event-data '${args.select}' — ${n}.`);
    },
  );
}
