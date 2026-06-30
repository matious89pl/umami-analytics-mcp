import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";
import type { Website } from "../umami/types";
import { ok } from "../util/output";
import { asCount, asList, paginationShape, reg, websiteIdShape } from "./shared";

export const websiteSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    domain: z.string().nullable().optional(),
    shareId: z.string().nullable().optional(),
    teamId: z.string().nullable().optional(),
    userId: z.string().nullable().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

export function registerWebsiteReadTools(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "list_websites",
    {
      title: "List websites",
      description:
        "List every website you can access (including team sites). CALL THIS FIRST — every other tool needs a website ID from here. Returns id, name, domain, createdAt.",
      inputSchema: {
        includeTeams: z.boolean().optional().describe("Include team-owned websites (default true)."),
        ...paginationShape,
      },
      outputSchema: { data: z.array(websiteSchema), count: z.number() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const query = {
        search: args.search,
        page: args.page,
        pageSize: args.pageSize,
        includeTeams: args.includeTeams ?? true,
      };
      const path = ctx.umami.teamId ? `/teams/${ctx.umami.teamId}/websites` : "/websites";
      const res = await ctx.umami.get<unknown>(path, query);
      const data = asList<Website>(res);
      const count = asCount(res, data.length);
      const summary = data.length
        ? `${count} website(s):\n` +
          data
            .slice(0, 50)
            .map((w) => `• ${w.name ?? "(unnamed)"} — ${w.domain ?? "no domain"} — id=${w.id}`)
            .join("\n")
        : "No websites found for this account/team.";
      return ok({ data, count }, summary);
    },
  );

  reg(
    server,
    "get_website",
    {
      title: "Get website",
      description: "Fetch one website's metadata (name, domain, share settings, createdAt) by ID.",
      inputSchema: { ...websiteIdShape },
      outputSchema: { website: websiteSchema },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const website = await ctx.umami.get<Website>(`/websites/${encodeURIComponent(args.websiteId)}`);
      return ok(
        { website },
        `${website.name ?? "(unnamed)"} — ${website.domain ?? "no domain"} — created ${website.createdAt ?? "?"}`,
      );
    },
  );

  reg(
    server,
    "get_website_daterange",
    {
      title: "Get website data range",
      description:
        "Return the earliest and latest timestamps for which a website has analytics data. Use this to choose a valid window before querying stats/metrics.",
      inputSchema: { ...websiteIdShape },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await ctx.umami.get<Record<string, unknown>>(
        `/websites/${encodeURIComponent(args.websiteId)}/daterange`,
      );
      const min = data?.["mindate"] ?? data?.["min"] ?? "?";
      const max = data?.["maxdate"] ?? data?.["max"] ?? "?";
      return ok({ data }, `Data available from ${String(min)} to ${String(max)}.`);
    },
  );
}
