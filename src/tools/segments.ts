import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";
import { num, ok } from "../util/output";
import { asCount, asList, paginationShape, reg, websiteIdShape } from "./shared";

export function registerSegmentReadTools(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "list_segments",
    {
      title: "List segments & cohorts",
      description: "List saved segments and cohorts defined for a website.",
      inputSchema: { ...websiteIdShape, ...paginationShape },
      outputSchema: { websiteId: z.string(), count: z.number(), data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const res = await ctx.umami.get<unknown>(`/websites/${encodeURIComponent(args.websiteId)}/segments`, {
        page: args.page,
        pageSize: args.pageSize,
        search: args.search,
      });
      const data = asList(res);
      return ok(
        { websiteId: args.websiteId, count: asCount(res, data.length), data },
        `${num(asCount(res, data.length))} segment(s).`,
      );
    },
  );

  reg(
    server,
    "get_segment",
    {
      title: "Get segment",
      description: "Fetch a single segment/cohort definition by ID.",
      inputSchema: {
        ...websiteIdShape,
        segmentId: z.string().min(1).describe("Segment/cohort ID."),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await ctx.umami.get<unknown>(
        `/websites/${encodeURIComponent(args.websiteId)}/segments/${encodeURIComponent(args.segmentId)}`,
      );
      return ok({ data }, `Segment ${args.segmentId} retrieved.`);
    },
  );
}
