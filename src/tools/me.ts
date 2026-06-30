import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { MeResponse } from "../umami/types";
import type { UmamiContext } from "../server";
import { ok } from "../util/output";
import { redact } from "../util/redact";
import { reg } from "./shared";

export function registerMeTool(server: McpServer, ctx: UmamiContext): void {
  reg(
    server,
    "get_me",
    {
      title: "Get current account",
      description:
        "Return the authenticated account's profile: id, username, role, isAdmin, and teams. Credentials/tokens are stripped from the response.",
      inputSchema: {},
      outputSchema: { user: z.unknown(), deployment: z.string() },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const me = await ctx.umami.getMe();
      // Defense in depth: redact() masks any token/authKey/shareToken fields.
      const user = redact<MeResponse>(me);
      const name = user.username ?? user.user?.username ?? "(unknown)";
      const role = user.role ?? user.user?.role ?? "?";
      const teamCount = Array.isArray(user.teams) ? user.teams.length : 0;
      return ok(
        { user, deployment: ctx.deployment },
        `Signed in as ${name} (role: ${role}) on ${ctx.deployment}; ${teamCount} team(s).`,
      );
    },
  );
}
