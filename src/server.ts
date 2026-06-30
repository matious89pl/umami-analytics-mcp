import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ResolvedScopes } from "./capabilities";
import type { UmamiClient } from "./umami/client";
import type { Deployment } from "./umami/types";
import { VERSION, SERVER_NAME } from "./version";

/**
 * Runtime context shared by every tool/resource/prompt handler.
 *
 * Built once from environment + flags (see config.ts) and threaded through
 * {@link registerAll}. Tools close over this object; they never read credentials
 * from the environment directly.
 */
export interface UmamiContext {
  /** Configured Umami API client (handles auth, throttling, redaction). */
  readonly umami: UmamiClient;
  /** Effective capability tiers controlling which tools are registered. */
  readonly scopes: ResolvedScopes;
  /** Cloud vs self-hosted — gates admin tools and informs error hints. */
  readonly deployment: Deployment;
  readonly defaults: {
    /** IANA timezone applied to time-series tools unless overridden per call. */
    readonly timezone: string;
  };
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
