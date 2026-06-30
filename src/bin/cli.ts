#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { describeScopes } from "../capabilities";
import { buildContext, loadConfig } from "../config";
import { createServer } from "../server";
import { UmamiConfigError } from "../umami/errors";
import { SERVER_NAME, VERSION } from "../version";

const HELP = `${SERVER_NAME} v${VERSION}

A security-first MCP server for Umami analytics (Cloud + self-hosted).
Runs over stdio; configure your MCP client to launch it with credentials in env.

Credentials (env only — never pass secrets as flags):
  Umami Cloud:    UMAMI_API_KEY            (+ optional UMAMI_CLOUD_REGION=us|eu)
  Self-hosted:    UMAMI_API_URL UMAMI_USERNAME UMAMI_PASSWORD
  Self-hosted+key:UMAMI_API_URL UMAMI_API_KEY

Capability tiers (default: read-only):
  UMAMI_ENABLE_WRITE=1        expose create/update + send-event tools
  UMAMI_ENABLE_ADMIN=1        expose user-management tools (self-hosted only)
  UMAMI_ALLOW_DESTRUCTIVE=1   also required for delete/reset tools

Flags: --api-url --cloud-region --team-id --timezone --write --admin
       --allow-destructive --help --version
`;

/**
 * stdio entrypoint — the binary invoked by `npx umami-analytics-mcp`.
 *
 * IMPORTANT: stdout is the JSON-RPC channel. All diagnostics MUST go to stderr
 * (`console.error`); a stray `console.log` corrupts the protocol stream.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = loadConfig();
  const context = buildContext(config);
  const server = createServer(context);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `${SERVER_NAME} v${VERSION} ready on stdio — ${config.deployment}, ${describeScopes(config.scopes)}`,
  );
  for (const note of config.scopes.notes) console.error(`  note: ${note}`);
}

main().catch((err: unknown) => {
  if (err instanceof UmamiConfigError) {
    console.error(`Configuration error:\n${err.message}`);
  } else {
    console.error(`${SERVER_NAME} fatal:`, err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
