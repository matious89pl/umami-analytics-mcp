# Umami Analytics MCP Server — Design Spec

> Status: **approved-to-build** (design presented; proceeding under `/goal` autonomous directive — redirect anytime)
> Date: 2026-06-30
> Package: `umami-analytics-mcp` · bin: `umami-mcp`

## 1. Purpose & goals

A comprehensive, security-first **Model Context Protocol** server that lets an LLM **set up, analyze, and report** on a [Umami](https://umami.is) analytics instance — covering **both Umami Cloud and self-hosted** deployments. It gives the model **near-full control of the instance when (and only when) the operator deliberately enables it**, defaulting to safe read-only.

It must be:

- **Lightweight & local-first** — runs instantly via `npx umami-analytics-mcp` over stdio, zero build step for the user, minimal dependencies.
- **Deployable to Vercel** — the same codebase runs as a remote Streamable-HTTP server via `mcp-handler`, with the remote endpoint auth-gated.
- **Credential-safe** — secrets live only in environment variables, are never placed in tool arguments/outputs/logs, and are never sent to any third party.
- **Comprehensive** — wraps the high-value 90% of the Umami **v3** API: websites, full stats/metrics, events & event-data, sessions & session-data, realtime, **reports** (funnel, retention, journey, goals, attribution, revenue, UTM, breakdown, web-vitals), segments, teams, share links, event ingestion, and (self-hosted) user/admin management.

### Why this beats the reference (`Macawls/umami-mcp-server`)

The reference is a clean Go server but **read-only** with **8 tools**. This server adds, on top of full read coverage:

1. **Write + admin** — website CRUD, team/member management, segments, reports CRUD, **send events**, and self-hosted **user administration** (the "almost full control" requirement), all permission-tiered.
2. **Reports & event-data & session-data** — Umami v3's highest-value analytics, entirely absent from the reference.
3. **Hardening** — in-memory token caching with **re-auth on 401**, Cloud **rate-limit throttle + 429 backoff**, capability detection (Cloud vs self-hosted), structured output with token-efficient summaries.
4. **Security posture** — no query-param credentials, central redaction, auth-gated remote endpoint, and an explicit refusal to operate a shared hosted instance that would collect users' Umami credentials.

## 2. Non-goals (YAGNI)

- **No multi-tenant credential brokering.** Single-tenant "deploy-your-own": one operator's Umami credentials per server instance. (Per-request credential mapping is documented as a future extension only.)
- **No SDK v2 (split packages).** v1.x is the production-recommended line and what `mcp-handler` targets.
- **No hosted shared instance** that collects third-party credentials (the reference's `*.dev` endpoint pattern — deliberately avoided).
- **Not every v3 endpoint on day one.** Lower-value/edge surfaces — session replay *recording* ingestion, heatmap recording, pixels/boards/tracked-links CRUD, SSO — are deferred behind the same client and tier scaffolding so they're trivial to add later.

## 3. Tech stack & dependencies (versions verified 2026-06-30)

| Package | Version | Role |
|---|---|---|
| `@modelcontextprotocol/sdk` | **`1.26.0`** (exact — see note) | MCP server: `McpServer`, `registerTool`, stdio + Streamable-HTTP transports |

> **SDK pin note:** `mcp-handler@1.1.0` declares an *exact* peer on `@modelcontextprotocol/sdk@1.26.0`, so the root pins `1.26.0` exactly. This is also the documented security floor (the pre-1.26.0 vulnerability is excluded), and it guarantees stdio and Vercel run the identical SDK build — the shared-core invariant.
| `zod` | `^3.25` | Input/output schema validation (v3 to match `mcp-handler` peer) |
| `mcp-handler` | `^1.1.0` | Vercel adapter: `createMcpHandler`, `withMcpAuth`, `protectedResourceHandler` (Vercel route only) |

- **Runtime:** Node **≥20** (developed on 22). **ESM** (`"type": "module"`, `.js` import specifiers).
- **HTTP to Umami:** native global `fetch` — no axios/node-fetch.
- **Build:** `tsup` (bundles the CLI into one file, preserves shebang). Vercel transpiles its own route.
- **Dev only (not shipped):** `typescript`, `tsup`, `vitest`, `@types/node`. MCP Inspector via `npx`.

## 4. Architecture — one core, three transports

A single registration core is imported by every entrypoint, so transports never drift.

```
src/server.ts
  registerAll(server, ctx)   // registers every enabled tool/resource/prompt onto a server
  createServer(ctx)          // builds a McpServer + registerAll (used by stdio)

Entrypoints (all reuse registerAll/createServer):
  src/bin/cli.ts             // [PRIMARY] stdio via StdioServerTransport — `npx`
  src/http/server.ts         // [BONUS]   standalone Node Streamable-HTTP server — Docker/self-host
  api/[transport]/route.ts   // [VERCEL]  mcp-handler createMcpHandler + withMcpAuth
```

`ctx` (a `UmamiContext`) carries the configured Umami client + resolved capability scopes. It is built once from env/flags (stdio, standalone, Vercel single-tenant). Tools close over `ctx`; they never read credentials directly.

## 5. Configuration & credential model

**Single-tenant, deploy-your-own.** Credentials come from the environment only.

### Environment variables

| Var | Mode | Meaning |
|---|---|---|
| `UMAMI_API_URL` | self-hosted | Base URL of the instance (e.g. `https://stats.example.com`). `/api` appended automatically. |
| `UMAMI_USERNAME` / `UMAMI_PASSWORD` | self-hosted | Login credentials → `POST /api/auth/login` → Bearer token (cached in memory). |
| `UMAMI_API_KEY` | Cloud | Umami Cloud API key → `x-umami-api-key`. Presence selects Cloud mode. |
| `UMAMI_CLOUD_REGION` | Cloud (opt) | `us` or `eu` → `https://api.umami.is/v1/{region}`. Default: `https://api.umami.is/v1`. |
| `UMAMI_TEAM_ID` | both (opt) | Scope website listing to a team. |
| `UMAMI_DEFAULT_TIMEZONE` | both (opt) | IANA tz default for time-series tools (default `UTC`). |
| `UMAMI_ENABLE_WRITE` | both (opt) | `1`/`true` → register WRITE tools. Default off. |
| `UMAMI_ENABLE_ADMIN` | both (opt) | `1`/`true` → register ADMIN (user-management) tools. Self-hosted only; ignored on Cloud. |
| `UMAMI_ALLOW_DESTRUCTIVE` | both (opt) | `1`/`true` → additionally permit delete/reset tools (requires the relevant tier too). Default off. |
| `MCP_AUTH_TOKEN` | remote only | Shared-secret bearer required to call the HTTP/Vercel endpoint. |

Equivalent CLI flags exist for non-secret options (`--api-url`, `--cloud-region`, `--team-id`, `--write`, `--admin`, `--allow-destructive`, `--timezone`). **Secrets are env-only** (never flags — they leak into shell history/process lists).

`loadConfig()` validates everything with Zod and **fails fast to stderr** with an actionable message (e.g. "set UMAMI_API_KEY for Cloud, or UMAMI_API_URL + UMAMI_USERNAME + UMAMI_PASSWORD for self-hosted").

## 6. Security model

- **Secrets in env only.** Never committed, never in flags, never persisted to disk. The Bearer token is cached **in memory** for the process lifetime and re-fetched on 401.
- **Never logged.** A `redact()` helper scrubs tokens/passwords/`Authorization`/`x-umami-api-key` from every error before it is logged or surfaced. stdio logs go to **stderr only** (stdout is the JSON-RPC channel). Vercel handler runs with `verboseLogs: false`.
- **Never echoed in tool output.** Tool results are sent to the model. `get_me` and any user/error payloads are sanitized to strip `token`, `authKey`, `shareToken`, password fields, and reflected auth headers. Every tool test asserts the configured secret never appears in output.
- **Remote endpoint is auth-gated.** `withMcpAuth(handler, verifyToken, { required: true })`. Default `verifyToken` does a **constant-time** compare against `MCP_AUTH_TOKEN`; an OAuth protected-resource variant is documented for spec-compliant clients. Unauthenticated → 401.
- **Defense in depth (docs).** Recommend Vercel Deployment Protection (lock preview URLs) + Firewall. DNS-rebinding host validation is enabled for the standalone localhost HTTP server.
- **No third-party credential collection.** README explicitly warns against pointing this (or any) MCP server's credentials at someone else's hosted instance.

## 7. Capability tiers & gating

Three opt-in scopes, layered **on top of** Umami's own RBAC (the API still enforces the account's real permissions — the tier only controls which tools are *exposed*).

- **`read` (always on):** websites list/get/daterange, active/realtime, stats, pageviews, metrics (+expanded), values, events (+series/stats), event-data (overview/fields/properties/values/stats), sessions (list/get/activity/stats/properties), reports (funnel/retention/journey/goals/attribution/revenue/utm/breakdown/performance), saved reports (list/get), segments (list/get), teams (list/get/members), `get_me`.
- **`write` (`UMAMI_ENABLE_WRITE`):** create/update website, share-link management, transfer website, send event, team CRUD + membership, segment CRUD, saved-report CRUD.
- **`admin` (`UMAMI_ENABLE_ADMIN`, self-hosted only):** user list/get/create/update, set role.

**Destructive operations** (`delete_website`, `reset_website`, `delete_team`, `delete_segment`, `delete_report`, `delete_user`) require their tier **and** `UMAMI_ALLOW_DESTRUCTIVE=1`. All tools carry MCP **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so clients can warn users.

Only enabled-tier tools are registered, so a read-only deployment presents a clean, focused tool list. On Cloud, admin tools are auto-omitted and a clear message explains why.

## 8. Umami API client (cross-cutting) — `src/umami/`

A single `UmamiClient` abstracts both deployments:

- **Auth modes:** Cloud (`x-umami-api-key`) vs self-hosted (login → Bearer). Base URL resolution (`{host}/api` vs `https://api.umami.is/v1[/region]`).
- **Token lifecycle:** lazy login, in-memory cache, automatic **re-auth + single retry on 401** (fixes the reference's no-refresh gap).
- **Rate limiting:** for Cloud, a small token-bucket throttle (~50 req / 15 s) plus **exponential backoff on HTTP 429**.
- **Timeouts & errors:** per-request timeout via `AbortController`; typed, **redacted**, actionable errors (e.g. surfacing "section not permitted" 401s clearly).
- **Date normalization:** one helper accepts ISO strings, **relative ranges** ("7d", "last 30 days", "today", "this month"), or epoch — emits **ms** for stats and **s** for `/api/send` (the units differ — centralized to prevent the footgun).
- **Capability detection:** on first use, `verify`/`me` determines Cloud vs self-hosted and admin availability; cached.
- **Structured output:** typed response shapes; tools return `structuredContent` + a compact text summary (token-efficient vs the reference's always-pretty JSON), trimming oversized metric/session payloads.

## 9. Tool catalog

Naming: `get_*`/`list_*` (read), `report_*` (analytics reports), `create_*`/`update_*`/`delete_*`/`send_*` (write/admin). Consolidate where it helps the model (e.g. one `get_metrics` with a validated `type` enum, not 20 tools).

### Read (always registered)
`list_websites`, `get_website`, `get_website_daterange`, `get_active_visitors`, `get_realtime`, `get_stats`, `get_pageviews`, `get_metrics` (type enum: path, referrer, browser, os, device, country, region, city, language, screen, event, hostname, title, query, utmSource/Medium/Campaign/Content/Term, tag, channel, distinctId), `get_website_values`, `get_events`, `get_event_stats`, `get_event_data` (overview/fields/properties/values via `select`), `list_sessions`, `get_session`, `get_session_activity`, `get_session_stats`, `report_funnel`, `report_retention`, `report_journey`, `report_goals`, `report_attribution`, `report_revenue`, `report_utm`, `report_breakdown`, `report_performance`, `list_reports`, `get_report`, `list_segments`, `get_segment`, `list_teams`, `get_team`, `get_team_members`, `get_me`.

### Write (`UMAMI_ENABLE_WRITE`)
`create_website`, `update_website`, `transfer_website`, `manage_website_share` (enable/disable/get share URL), `send_event` (`/api/send`: event | identify | performance; exactly one of website/link/pixel; User-Agent set; seconds timestamp), `create_team`, `update_team`, `join_team`, `add_team_member`, `update_team_member`, `remove_team_member`, `create_segment`, `update_segment`, `create_report`, `update_report`.

### Admin (`UMAMI_ENABLE_ADMIN`, self-hosted)
`list_users`, `get_user`, `create_user`, `update_user`, `set_user_role`.

### Destructive (tier + `UMAMI_ALLOW_DESTRUCTIVE`)
`delete_website`, `reset_website`, `delete_team`, `delete_segment`, `delete_report`, `delete_user`.

## 10. Resources & prompts

- **Resources:** `umami://websites` (list), `umami://website/{id}` (metadata + daterange), `umami://me` (sanitized profile).
- **Prompts** (server-side templates that teach correct tool-chaining): `analytics_report`, `traffic_overview`, `top_pages`, `acquisition_channels`, `realtime_check`, `funnel_analysis`, `retention_analysis`, `audience_insights`, `compare_periods`.

## 11. Deployment modes

1. **Local (npx)** — primary. Client config runs `npx -y umami-analytics-mcp` with env vars. stdio.
2. **Vercel** — `api/[transport]/route.ts` via `createMcpHandler` + `withMcpAuth` (shared-secret default). Node runtime + Fluid Compute; per-route `maxDuration`. Env vars hold creds + `MCP_AUTH_TOKEN`. Connect at `/api/mcp`; stdio-only clients bridge via `npx mcp-remote <url>`.
3. **Docker / self-host (bonus)** — standalone Node Streamable-HTTP server (`src/http/server.ts`) using the SDK's `StreamableHTTPServerTransport` directly, reusing `registerAll`. Minimal Dockerfile. Bearer-gated; host-header/DNS-rebind validation on.

## 12. Testing strategy

- **Unit (Vitest):** config + redaction; `UmamiClient` with mocked `fetch` (both auth modes, base-URL resolution, 401 re-auth, 429 backoff, error redaction); date/relative-range normalization; representative tool handlers with a mocked client — assert `structuredContent` shape **and** that the configured secret never appears in output (shared `assertNoSecretLeak` helper).
- **Integration:** SDK `InMemoryTransport.createLinkedPair()` — real `Client` ↔ `createServer()`; assert tool lists per tier and a few end-to-end `callTool` paths (schema validation included).
- **Manual smoke:** MCP Inspector against the stdio CLI and the HTTP endpoint (incl. auth reject/accept). Documented in README.

## 13. Project structure

```
umami-analytics-mcp/
├─ package.json  tsconfig.json  tsup.config.ts  vitest.config.ts
├─ .gitignore  .env.example  LICENSE  README.md  SECURITY.md
├─ vercel.json                         # Node runtime + maxDuration for the route
├─ .github/workflows/ci.yml            # build + test + typecheck
├─ src/
│  ├─ server.ts                        # registerAll / createServer (SHARED)
│  ├─ config.ts                        # env+flags → UmamiContext (Zod), redaction
│  ├─ capabilities.ts                  # tier resolution + Cloud/self-hosted detection
│  ├─ bin/cli.ts                       # stdio entrypoint (#!/usr/bin/env node)
│  ├─ http/server.ts                   # standalone Streamable-HTTP server (Docker)
│  ├─ umami/{client.ts,types.ts,dates.ts,errors.ts,rateLimit.ts}
│  ├─ tools/{websites,stats,metrics,events,sessions,reports,segments,teams,users,send,me}.ts
│  ├─ resources/index.ts
│  ├─ prompts/index.ts
│  └─ util/{redact.ts,summarize.ts,output.ts}
├─ api/[transport]/route.ts            # Vercel
├─ app/.well-known/oauth-protected-resource/route.ts   # optional OAuth discovery
└─ test/** (vitest)
```

## 14. Packaging & docs

- `package.json`: `"type":"module"`, `bin: { "umami-mcp": "./dist/cli.js" }`, `files: ["dist"]`, `exports` (so the Vercel route can import the core), `engines.node ">=20"`, `prepublishOnly: build`.
- **README:** quickstart (`npx`), client snippets (Claude Desktop/Code, Cursor, VS Code), Cloud vs self-hosted setup, scope flags, security model, Vercel deploy guide, Docker, full tool table.
- **SECURITY.md:** threat model, redaction guarantees, the third-party-credential warning.
- MIT LICENSE. `.env.example`. CI.

## 15. Implementation phases

1. **Foundation** — package.json, tsconfig, tsup, vitest, .gitignore, .env.example, dir skeleton.
2. **Core** — `util/redact`, `umami/{dates,errors,rateLimit,types,client}`, `config`, `capabilities`. Unit-tested.
3. **Read tools** + resources + prompts + `server.ts`. `bin/cli.ts`. Inspector smoke.
4. **Write + admin tools**, destructive gating.
5. **Transports** — standalone HTTP server; Vercel route + `withMcpAuth`; `vercel.json`.
6. **Tests** — fill unit + in-memory integration coverage; redaction assertions.
7. **Docs & packaging** — README, SECURITY, LICENSE, CI; build + `npm pack` dry-run; final verification.

## 16. Key decisions & assumptions (correct me if wrong)

- **Single-tenant deploy-your-own** credential model (you control one Umami instance per server). Multi-tenant is out of scope.
- **Read-only by default; write/admin opt-in** via env flags; **destructive double-gated** — this is how "near-full control if rights allow" is delivered safely.
- **TypeScript + MCP SDK v1.x** (your "your choice" on stack).
- **Three transports** (stdio + Vercel + standalone Docker) from one core; stdio and Vercel are must-haves, Docker is a bonus.
- Publish name **`umami-analytics-mcp`** (both obvious names were taken on npm); short bin command `umami-mcp`.
