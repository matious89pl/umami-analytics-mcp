#!/usr/bin/env node
import { describeScopes } from "../capabilities";
import { applyEnvFileFlag, buildContext, loadConfig } from "../config";
import { startHttpServer } from "../http/server";
import { UmamiConfigError } from "../umami/errors";
import { SERVER_NAME, VERSION } from "../version";

/**
 * Standalone HTTP entrypoint (Docker / self-host). Reuses the same config and
 * shared core as the stdio CLI. Bearer-gated by default; set MCP_ALLOW_INSECURE=1
 * to run without auth (localhost development ONLY).
 */
function main(): void {
  applyEnvFileFlag(process.argv.slice(2));
  const config = loadConfig();
  const ctx = buildContext(config);

  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "127.0.0.1";
  const authToken = process.env.MCP_AUTH_TOKEN;
  const insecure = /^(1|true|yes|on)$/i.test(process.env.MCP_ALLOW_INSECURE ?? "");
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!authToken && !insecure) {
    console.error(
      `${SERVER_NAME}: WARNING — MCP_AUTH_TOKEN is not set; the endpoint will reject ALL requests (fail-closed). Set MCP_AUTH_TOKEN, or MCP_ALLOW_INSECURE=1 for localhost-only testing.`,
    );
  }

  startHttpServer(ctx, {
    port,
    host,
    authToken,
    requireAuth: !insecure,
    allowedHosts,
  });

  console.error(
    `${SERVER_NAME} v${VERSION} HTTP ready on http://${host}:${port}/mcp — ${config.deployment}, ${describeScopes(config.scopes)}${insecure ? " — AUTH DISABLED (insecure)" : ""}`,
  );
  for (const note of config.scopes.notes) console.error(`  note: ${note}`);
}

try {
  main();
} catch (err) {
  if (err instanceof UmamiConfigError) {
    console.error(`Configuration error:\n${err.message}`);
  } else {
    console.error(`${SERVER_NAME} fatal:`, err instanceof Error ? err.message : err);
  }
  process.exit(1);
}
