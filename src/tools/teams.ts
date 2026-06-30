import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Team } from "../umami/types";
import type { UmamiContext } from "../server";
import { num, ok } from "../util/output";
import { asCount, asList, paginationShape, reg } from "./shared";

const teamSchema = z
  .object({ id: z.string(), name: z.string().optional(), createdAt: z.string().optional() })
  .passthrough();

const teamIdShape = { teamId: z.string().min(1).describe("Umami team ID.") } as const;

export function registerTeamReadTools(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "list_teams",
    {
      title: "List teams",
      description: "List teams you belong to (id, name, role). Available on both Cloud and self-hosted.",
      inputSchema: { ...paginationShape },
      outputSchema: { count: z.number(), data: z.array(teamSchema) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const res = await ctx.umami.get<unknown>("/teams", {
        page: args.page,
        pageSize: args.pageSize,
        search: args.search,
      });
      const data = asList<Team>(res);
      const count = asCount(res, data.length);
      const summary = data.length
        ? `${count} team(s):\n` + data.slice(0, 50).map((t) => `• ${t.name ?? "(unnamed)"} — id=${t.id}`).join("\n")
        : "No teams.";
      return ok({ count, data }, summary);
    },
  );

  reg(
    server,
    "get_team",
    {
      title: "Get team",
      description: "Fetch a single team's metadata by ID.",
      inputSchema: { ...teamIdShape },
      outputSchema: { team: teamSchema },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const team = await ctx.umami.get<Team>(`/teams/${encodeURIComponent(args.teamId)}`);
      return ok({ team }, `${team.name ?? "(unnamed)"} — id=${team.id}`);
    },
  );

  reg(
    server,
    "get_team_members",
    {
      title: "Get team members",
      description: "List members of a team and their roles (team-owner, team-manager, team-member, team-view-only).",
      inputSchema: { ...teamIdShape, ...paginationShape },
      outputSchema: { count: z.number(), data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const res = await ctx.umami.get<unknown>(`/teams/${encodeURIComponent(args.teamId)}/users`, {
        page: args.page,
        pageSize: args.pageSize,
        search: args.search,
      });
      const data = asList(res);
      return ok({ count: asCount(res, data.length), data }, `${num(asCount(res, data.length))} member(s).`);
    },
  );
}
