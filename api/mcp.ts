import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { buildContext, loadConfig } from "../src/config";
import { checkBearer, extractBearer } from "../src/http/auth";
import { registerAll } from "../src/server";

/**
 * Vercel remote transport — a plain Vercel Function (Web handler) at /api/mcp.
 *
 * Single-tenant "deploy-your-own": the operator's Umami credentials come from
 * Vercel Environment Variables, loaded once at cold start. The endpoint itself
 * is gated by a shared-secret bearer (MCP_AUTH_TOKEN) so it can't be hit
 * anonymously. `mcp-handler` is a devDependency traced into the function at
 * build time, so the npx package never ships it.
 */
const context = buildContext(loadConfig(process.env, []));

if (!process.env.MCP_AUTH_TOKEN) {
  console.error(
    "[umami-analytics-mcp] WARNING: MCP_AUTH_TOKEN is not set — the hosted endpoint will reject ALL requests until you set it (fail-closed).",
  );
}

const mcpHandler = createMcpHandler((server) => registerAll(server, context), {}, {
  basePath: "/api",
  verboseLogs: false,
  maxDuration: 60,
});

async function verifyToken(req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const token = bearerToken ?? extractBearer(req.headers.get("authorization"));
  if (!checkBearer(token, process.env.MCP_AUTH_TOKEN)) return undefined;
  return { token: token as string, clientId: "umami-analytics-mcp", scopes: [] };
}

const handler = withMcpAuth(mcpHandler, verifyToken, { required: true });

export { handler as GET, handler as POST, handler as DELETE };
export const maxDuration = 60;
