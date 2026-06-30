import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { UmamiContext } from "../server";
import { asList } from "../tools/shared";
import { redact } from "../util/redact";

/** A few high-value, read-only resources for clients that browse by URI. */
export function registerResources(server: McpServer, ctx: UmamiContext): void {
  server.registerResource(
    "websites",
    "umami://websites",
    { title: "Umami websites", description: "All accessible websites", mimeType: "application/json" },
    async (uri) => {
      const path = ctx.umami.teamId ? `/teams/${ctx.umami.teamId}/websites` : "/websites";
      const res = await ctx.umami.get<unknown>(path, { includeTeams: true });
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(asList(res), null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    "website",
    new ResourceTemplate("umami://website/{id}", { list: undefined }),
    { title: "Umami website", description: "One website's metadata", mimeType: "application/json" },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0]! : String(variables.id);
      const data = await ctx.umami.get<unknown>(`/websites/${encodeURIComponent(id)}`);
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  server.registerResource(
    "me",
    "umami://me",
    { title: "Current account", description: "Authenticated profile (sanitized)", mimeType: "application/json" },
    async (uri) => {
      const me = redact(await ctx.umami.getMe());
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(me, null, 2) }],
      };
    },
  );
}
