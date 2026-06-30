import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { VERSION, SERVER_NAME } from "./version";

/**
 * Runtime context shared by every tool/resource/prompt handler.
 *
 * Built once from environment + flags (see {@link file://./config.ts}) and
 * threaded through {@link registerAll}. Tools close over this object; they never
 * read credentials from the environment directly. Expanded in Phase 2 to carry
 * the configured Umami client and resolved capability scopes.
 */
export interface UmamiContext {
  // Phase 2: umami client, scopes, defaults.
  readonly placeholder?: never;
}

/**
 * Register every enabled capability onto an existing server.
 *
 * This is the single source of truth shared by all transports (stdio CLI,
 * standalone HTTP, Vercel `mcp-handler`), so the tool surface can never drift
 * between local and hosted modes.
 */
export function registerAll(_server: McpServer, _ctx: UmamiContext): void {
  // Tools/resources/prompts are registered here in Phase 3+.
}

/**
 * Build a fully-configured {@link McpServer}. Used by the stdio entrypoint,
 * which owns the server lifecycle. (The Vercel route lets `mcp-handler` own the
 * lifecycle and calls {@link registerAll} instead.)
 */
export function createServer(ctx: UmamiContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  registerAll(server, ctx);
  return server;
}
