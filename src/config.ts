import { z } from "zod";

import { resolveScopes, type ResolvedScopes } from "./capabilities";
import type { UmamiContext } from "./server";
import { UmamiClient } from "./umami/client";
import { UmamiConfigError } from "./umami/errors";
import { registerSecret } from "./util/redact";
import type { AuthConfig, Deployment } from "./umami/types";

export interface AppConfig {
  deployment: Deployment;
  /** Fully-resolved base URL incl. `/api` or `/v1[/region]`. */
  baseUrl: string;
  auth: AuthConfig;
  teamId?: string;
  timezone: string;
  sendUrl?: string;
  scopes: ResolvedScopes;
  /** Shared-secret required by the remote (HTTP/Vercel) transports. */
  mcpAuthToken?: string;
}

type FlagValue = string | boolean;

const CLOUD_BASE = "https://api.umami.is/v1";
const regionSchema = z.enum(["us", "eu"]);

/** Minimal `--flag value` / `--flag=value` / boolean `--flag` parser. */
export function parseFlags(argv: readonly string[]): Record<string, FlagValue> {
  const out: Record<string, FlagValue> = {};
  const booleanFlags = new Set(["write", "admin", "allow-destructive", "help", "version"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (booleanFlags.has(body)) {
      out[body] = true;
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[body] = next;
        i += 1;
      } else {
        out[body] = true;
      }
    }
  }
  return out;
}

const truthy = (value: FlagValue | undefined): boolean =>
  value === true || (typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim()));

function normalizeHost(raw: string): string {
  let host = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  return host;
}

/**
 * Resolve configuration from environment + CLI flags. Secrets come from env
 * only (never flags). Throws {@link UmamiConfigError} with actionable guidance
 * when the credential set is incomplete.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): AppConfig {
  const flags = parseFlags(argv);
  const flag = (name: string): string | undefined =>
    typeof flags[name] === "string" ? (flags[name] as string) : undefined;

  const apiKey = env.UMAMI_API_KEY?.trim() || undefined;
  const apiUrl = flag("api-url") ?? env.UMAMI_API_URL?.trim() ?? undefined;
  const username = env.UMAMI_USERNAME?.trim() || undefined;
  const password = env.UMAMI_PASSWORD || undefined;
  const regionRaw = flag("cloud-region") ?? env.UMAMI_CLOUD_REGION?.trim();
  const teamId = flag("team-id") ?? env.UMAMI_TEAM_ID?.trim() ?? undefined;
  const timezone = flag("timezone") ?? env.UMAMI_DEFAULT_TIMEZONE?.trim() ?? "UTC";
  const sendUrl = flag("send-url") ?? env.UMAMI_SEND_URL?.trim() ?? undefined;
  const mcpAuthToken = env.MCP_AUTH_TOKEN?.trim() || undefined;

  // Register secrets for redaction as early as possible.
  registerSecret(apiKey);
  registerSecret(password);
  registerSecret(mcpAuthToken);

  let region: "us" | "eu" | undefined;
  if (regionRaw) {
    const parsed = regionSchema.safeParse(regionRaw.toLowerCase());
    if (!parsed.success) {
      throw new UmamiConfigError(`UMAMI_CLOUD_REGION must be "us" or "eu" (got "${regionRaw}")`);
    }
    region = parsed.data;
  }

  let deployment: Deployment;
  let baseUrl: string;
  let auth: AuthConfig;

  if (apiKey) {
    auth = { kind: "apiKey", apiKey };
    if (apiUrl) {
      // Self-hosted instance addressed with an API key.
      deployment = "self-hosted";
      baseUrl = `${normalizeHost(apiUrl)}/api`;
    } else {
      deployment = "cloud";
      baseUrl = region ? `${CLOUD_BASE}/${region}` : CLOUD_BASE;
    }
  } else if (apiUrl && username && password) {
    deployment = "self-hosted";
    baseUrl = `${normalizeHost(apiUrl)}/api`;
    auth = { kind: "login", username, password };
  } else {
    throw new UmamiConfigError(
      [
        "Missing Umami credentials. Provide ONE of:",
        "  • Umami Cloud:   UMAMI_API_KEY  (optional UMAMI_CLOUD_REGION=us|eu)",
        "  • Self-hosted:   UMAMI_API_URL + UMAMI_USERNAME + UMAMI_PASSWORD",
        "  • Self-hosted w/ API key: UMAMI_API_URL + UMAMI_API_KEY",
      ].join("\n"),
    );
  }

  const scopes = resolveScopes(
    {
      write: truthy(flags.write) || truthy(env.UMAMI_ENABLE_WRITE),
      admin: truthy(flags.admin) || truthy(env.UMAMI_ENABLE_ADMIN),
      destructive: truthy(flags["allow-destructive"]) || truthy(env.UMAMI_ALLOW_DESTRUCTIVE),
    },
    deployment,
  );

  return { deployment, baseUrl, auth, teamId, timezone, sendUrl, scopes, mcpAuthToken };
}

/** Construct the runtime {@link UmamiContext} from resolved configuration. */
export function buildContext(config: AppConfig): UmamiContext {
  const umami = new UmamiClient({
    baseUrl: config.baseUrl,
    auth: config.auth,
    deployment: config.deployment,
    teamId: config.teamId,
    sendUrl: config.sendUrl,
  });
  return {
    umami,
    scopes: config.scopes,
    deployment: config.deployment,
    defaults: { timezone: config.timezone },
  };
}
