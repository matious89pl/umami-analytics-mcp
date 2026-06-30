#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "../server";

/**
 * stdio entrypoint — the binary invoked by `npx umami-analytics-mcp`.
 *
 * IMPORTANT: stdout is the JSON-RPC channel. All diagnostics MUST go to stderr
 * (`console.error`); a stray `console.log` corrupts the protocol stream.
 */
async function main(): Promise<void> {
  // Phase 2 replaces the empty context with loadConfig() (env + flags).
  const server = createServer({});
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("umami-analytics-mcp: listening on stdio");
}

main().catch((err: unknown) => {
  console.error("umami-analytics-mcp fatal:", err);
  process.exit(1);
});
