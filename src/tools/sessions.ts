import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";
import { num, ok, pluckNumber } from "../util/output";
import {
  asCount,
  asList,
  dateRangeShape,
  filterShape,
  paginationShape,
  pickFilters,
  reg,
  resolveRange,
  websiteIdShape,
} from "./shared";

const sessionIdShape = {
  sessionId: z.string().min(1).describe("Umami session ID (from list_sessions)."),
} as const;

export function registerSessionReadTools(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "list_sessions",
    {
      title: "List sessions",
      description:
        "Paginated list of individual visitor sessions over a date range (id, browser, os, device, geo, screen, visits, views, firstAt/lastAt). Supports search + filters.",
      inputSchema: { ...websiteIdShape, ...dateRangeShape, ...paginationShape, ...filterShape },
      outputSchema: { websiteId: z.string(), count: z.number(), data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const res = await ctx.umami.get<unknown>(`/websites/${encodeURIComponent(args.websiteId)}/sessions`, {
        startAt,
        endAt,
        page: args.page,
        pageSize: args.pageSize,
        search: args.search,
        ...pickFilters(args),
      });
      const data = asList(res);
      const count = asCount(res, data.length);
      return ok({ websiteId: args.websiteId, count, data }, `${num(count)} session(s); ${data.length} on this page.`);
    },
  );

  reg(
    server,
    "get_session",
    {
      title: "Get session",
      description: "Fetch a single visitor session's details by session ID.",
      inputSchema: { ...websiteIdShape, ...sessionIdShape },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await ctx.umami.get<unknown>(
        `/websites/${encodeURIComponent(args.websiteId)}/sessions/${encodeURIComponent(args.sessionId)}`,
      );
      return ok({ data }, `Session ${args.sessionId} retrieved.`);
    },
  );

  reg(
    server,
    "get_session_activity",
    {
      title: "Get session activity",
      description:
        "Ordered pageview/event timeline for a single session (createdAt, urlPath, referrer, eventType, eventName) — effectively a data-level session replay.",
      inputSchema: { ...websiteIdShape, ...sessionIdShape, ...dateRangeShape },
      outputSchema: { sessionId: z.string(), count: z.number(), data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const res = await ctx.umami.get<unknown>(
        `/websites/${encodeURIComponent(args.websiteId)}/sessions/${encodeURIComponent(args.sessionId)}/activity`,
        { startAt, endAt },
      );
      const data = asList(res);
      return ok({ sessionId: args.sessionId, count: data.length, data }, `${num(data.length)} activity event(s).`);
    },
  );

  reg(
    server,
    "get_session_stats",
    {
      title: "Get session stats",
      description:
        "Aggregate session totals over a date range: pageviews, visitors, visits, countries, events — a session-centric overview.",
      inputSchema: { ...websiteIdShape, ...dateRangeShape, ...filterShape },
      outputSchema: { websiteId: z.string(), startAt: z.number(), endAt: z.number(), stats: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { startAt, endAt } = resolveRange(args);
      const stats = await ctx.umami.get<Record<string, unknown>>(
        `/websites/${encodeURIComponent(args.websiteId)}/sessions/stats`,
        { startAt, endAt, ...pickFilters(args) },
      );
      const summary = `Visitors ${num(pluckNumber(stats["visitors"]))}, visits ${num(
        pluckNumber(stats["visits"]),
      )}, pageviews ${num(pluckNumber(stats["pageviews"]))}, countries ${num(pluckNumber(stats["countries"]))}.`;
      return ok({ websiteId: args.websiteId, startAt, endAt, stats }, summary);
    },
  );

  reg(
    server,
    "get_session_properties",
    {
      title: "Get session properties",
      description: "List the custom properties attached to a single session (set via identify calls).",
      inputSchema: { ...websiteIdShape, ...sessionIdShape },
      outputSchema: { sessionId: z.string(), data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await ctx.umami.get<unknown>(
        `/websites/${encodeURIComponent(args.websiteId)}/sessions/${encodeURIComponent(args.sessionId)}/properties`,
      );
      return ok({ sessionId: args.sessionId, data }, `Properties for session ${args.sessionId} retrieved.`);
    },
  );
}
