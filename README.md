# umami-analytics-mcp

> Security-first [Model Context Protocol](https://modelcontextprotocol.io) server for [Umami](https://umami.is) analytics — **Umami Cloud and self-hosted (v3)**. Set up, analyze, report on, and (when you allow it) administer your Umami instance from any MCP client.

[![CI](https://github.com/matious89pl/umami-analytics-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/matious89pl/umami-analytics-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

- 🚀 **Local-first** — `npx umami-analytics-mcp`, zero build step, ~2 runtime deps.
- ☁️ **Or host it** — deploy to **Vercel** (one Web function) or run the bundled **Docker** HTTP server. One shared core, three transports.
- 🔒 **Credential-safe** — secrets live in env only; never placed in tool arguments, outputs, or logs (two-layer redaction). Remote endpoints are bearer-gated and **fail closed**.
- 🎚️ **Least privilege** — **read-only by default**; `write` and `admin` tiers are opt-in; destructive ops (delete/reset) are double-gated.
- 📊 **Comprehensive** — full Umami **v3** surface: stats, metrics, events, sessions, **reports** (funnel, retention, journey, attribution, revenue, UTM, web-vitals), segments, teams, share links, event ingestion, and self-hosted user administration.

---

## Contents

- [Quickstart (local / npx)](#quickstart-local--npx)
- [Configuration](#configuration)
- [Capability tiers](#capability-tiers)
- [MCP client setup](#mcp-client-setup)
- [Remote hosting](#remote-hosting) · [Vercel](#deploy-to-vercel) · [Docker / self-host](#docker--self-host)
- [Security model](#security-model)
- [Tool reference](#tool-reference)
- [Prompts & resources](#prompts--resources)
- [Development](#development)

---

## Quickstart (local / npx)

No install required. Point your MCP client at:

```bash
npx -y umami-analytics-mcp
```

…with credentials supplied via environment variables. For **Umami Cloud**, create an API key at *Dashboard → Settings → API keys* and set `UMAMI_API_KEY`. For **self-hosted**, set `UMAMI_API_URL` + `UMAMI_USERNAME` + `UMAMI_PASSWORD`. See [MCP client setup](#mcp-client-setup) for copy-paste configs.

By default the server is **read-only** (33 analytics tools). Opt into writes/admin explicitly — see [Capability tiers](#capability-tiers).

---

## Configuration

All configuration is via environment variables (secrets) and optional CLI flags (non-secrets).

| Variable | Mode | Description |
| --- | --- | --- |
| `UMAMI_API_KEY` | Cloud | Umami Cloud API key (selects Cloud mode). |
| `UMAMI_CLOUD_REGION` | Cloud | `us` or `eu` (optional regional base URL). |
| `UMAMI_API_URL` | self-hosted | Instance base URL, e.g. `https://stats.example.com` (`/api` appended). |
| `UMAMI_USERNAME` / `UMAMI_PASSWORD` | self-hosted | Login credentials → bearer token (cached, auto-renewed on 401). |
| `UMAMI_TEAM_ID` | both | Scope website listings to a team (optional). |
| `UMAMI_DEFAULT_TIMEZONE` | both | IANA tz for time-series tools (default `UTC`). |
| `UMAMI_ENABLE_WRITE` | both | `1` to expose create/update + `send_event` tools. |
| `UMAMI_ENABLE_ADMIN` | both | `1` to expose user-management tools (**self-hosted only**). |
| `UMAMI_ALLOW_DESTRUCTIVE` | both | `1` — also required to expose delete/reset tools. |
| `MCP_AUTH_TOKEN` | remote | Shared-secret bearer required by the Vercel/HTTP endpoints. |

> Self-hosted instances that issue API keys can use `UMAMI_API_URL` + `UMAMI_API_KEY` instead of username/password.

Surrounding quotes are stripped from values defensively. For local use you can keep settings in a file and load them with `--env-file`:

```bash
npx umami-analytics-mcp --env-file .env.local
```

Run `npx umami-analytics-mcp --help` for the full flag list.

---

## Capability tiers

The server exposes only the tools for the tiers you enable, layered **on top of** Umami's own role-based access (the API still enforces your account's real permissions — tiers just decide which tools are even visible).

| Tier | Enable with | Adds | Example tools |
| --- | --- | --- | --- |
| **read** | _(always on)_ | analytics & reporting | `get_stats`, `get_metrics`, `report_funnel`, `list_sessions` |
| **write** | `UMAMI_ENABLE_WRITE=1` | mutations + ingestion | `create_website`, `send_event`, `add_team_member` |
| **admin** | `UMAMI_ENABLE_ADMIN=1` _(self-hosted)_ | user administration | `create_user`, `set_user_role` |
| **destructive** | `UMAMI_ALLOW_DESTRUCTIVE=1` _(+ write/admin)_ | delete / reset | `delete_website`, `reset_website`, `delete_user` |

Tool counts: **33** read → **47** with write → **53** with destructive → **59** at full tier on self-hosted. On Cloud the admin tier is automatically disabled (Umami Cloud has no user-admin API) and the server explains why at startup. Destructive tools carry MCP `destructiveHint` annotations so clients can warn before running them.

---

## MCP client setup

### Claude Desktop / Cursor (`claude_desktop_config.json` / `.cursor/mcp.json`)

```jsonc
{
  "mcpServers": {
    "umami": {
      "command": "npx",
      "args": ["-y", "umami-analytics-mcp"],
      "env": {
        "UMAMI_API_KEY": "your_cloud_api_key"
        // self-hosted instead:
        // "UMAMI_API_URL": "https://stats.example.com",
        // "UMAMI_USERNAME": "admin",
        // "UMAMI_PASSWORD": "••••••",
        // opt into writes:
        // "UMAMI_ENABLE_WRITE": "1"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add umami \
  -e UMAMI_API_KEY=your_cloud_api_key \
  -- npx -y umami-analytics-mcp
```

### VS Code (`.vscode/mcp.json`)

```jsonc
{
  "servers": {
    "umami": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "umami-analytics-mcp"],
      "env": { "UMAMI_API_KEY": "your_cloud_api_key" }
    }
  }
}
```

---

## Remote hosting

Both remote transports require `MCP_AUTH_TOKEN`; without it they **reject every request** (fail closed). Clients authenticate with `Authorization: Bearer <MCP_AUTH_TOKEN>`.

### Deploy to Vercel

The repo ships a single Web function at [`api/mcp.ts`](api/mcp.ts) (no Next.js required).

1. Push this repo to GitHub and **Import** it in Vercel.
2. Set Environment Variables: your Umami credentials (`UMAMI_API_KEY` *or* `UMAMI_API_URL`+`UMAMI_USERNAME`+`UMAMI_PASSWORD`), optional tier flags, and a strong `MCP_AUTH_TOKEN`.
3. Deploy. Your endpoint is `https://<deployment>.vercel.app/api/mcp`.
4. **Harden**: enable Vercel **Deployment Protection** (locks preview URLs) and **Firewall**.

Connect a Streamable-HTTP-capable client to the URL with the bearer header. stdio-only clients bridge via:

```bash
npx mcp-remote https://<deployment>.vercel.app/api/mcp \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN"
```

### Docker / self-host

Runs the framework-free standalone HTTP server (`umami-mcp-http`):

```bash
docker build -t umami-mcp .
docker run --rm -p 8787:8787 \
  -e UMAMI_API_KEY=your_cloud_api_key \
  -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
  umami-mcp
# → endpoint at http://localhost:8787/mcp  (health: /health)
```

Or without Docker: `MCP_AUTH_TOKEN=… UMAMI_API_KEY=… npx -y umami-analytics-mcp umami-mcp-http` (bin `umami-mcp-http`). Set `HOST`, `PORT`, optional `MCP_ALLOWED_HOSTS` (enables DNS-rebinding protection), or `MCP_ALLOW_INSECURE=1` for **localhost-only** unauthenticated dev.

---

## Security model

- **Secrets in env only.** Never committed, never passed as flags, never persisted. The self-hosted bearer token is cached **in memory** and re-fetched on 401.
- **Never logged or echoed.** A redaction layer scrubs secrets by key *and* by literal value from every log line, error, and tool result. `get_me` and user/admin responses are sanitized of `token`/`authKey`/`shareToken`. stdio diagnostics go to **stderr** only (stdout is the JSON-RPC channel).
- **Remote endpoints are auth-gated and fail closed** — constant-time bearer comparison; no `MCP_AUTH_TOKEN` ⇒ all requests rejected.
- **Least privilege by default** — read-only unless you opt in; destructive operations double-gated and annotated.
- **No third-party credential collection.** Run your own instance of this server. Never point credentials at someone else's hosted MCP endpoint.

See [SECURITY.md](SECURITY.md) for the full threat model and disclosure policy.

---

## Tool reference

<details open>
<summary><strong>Read tier (33 — always on)</strong></summary>

`list_websites` · `get_website` · `get_website_daterange` · `get_active_visitors` · `get_realtime` · `get_stats` · `get_pageviews` · `get_metrics` · `get_website_values` · `get_events` · `get_event_data` · `list_sessions` · `get_session` · `get_session_activity` · `get_session_stats` · `get_session_properties` · `report_funnel` · `report_retention` · `report_journey` · `report_goals` · `report_attribution` · `report_revenue` · `report_utm` · `report_breakdown` · `report_performance` · `list_reports` · `get_report` · `list_segments` · `get_segment` · `list_teams` · `get_team` · `get_team_members` · `get_me`
</details>

<details>
<summary><strong>Write tier (UMAMI_ENABLE_WRITE)</strong></summary>

`create_website` · `update_website` · `manage_website_share` · `transfer_website` · `send_event` · `create_team` · `update_team` · `join_team` · `add_team_member` · `update_team_member` · `create_segment` · `update_segment` · `create_report` · `update_report`

Destructive (also needs `UMAMI_ALLOW_DESTRUCTIVE`): `delete_website` · `reset_website` · `delete_team` · `remove_team_member` · `delete_segment` · `delete_report`
</details>

<details>
<summary><strong>Admin tier (UMAMI_ENABLE_ADMIN — self-hosted)</strong></summary>

`list_users` · `get_user` · `create_user` · `update_user` · `set_user_role`

Destructive: `delete_user`
</details>

Every tool returns a concise **text summary** plus a typed `structuredContent` payload, and accepts flexible date ranges (`range: "7d" | "today" | "this-month"`, or explicit `startAt`/`endAt`).

---

## Prompts & resources

**Prompts** (server-side, teach correct tool-chaining): `analytics_report`, `traffic_overview`, `top_pages`, `acquisition_channels`, `realtime_check`, `funnel_analysis`, `retention_analysis`, `audience_insights`, `compare_periods`.

**Resources**: `umami://websites`, `umami://website/{id}`, `umami://me` (sanitized).

---

## Development

```bash
npm install
npm run build        # tsup → dist/{cli,http,server}.js
npm test             # vitest (58 tests)
npm run typecheck    # tsc --noEmit
npm run inspect      # MCP Inspector against the stdio CLI
```

Architecture: a single `registerAll(server, ctx)` core ([src/server.ts](src/server.ts)) is shared by the stdio CLI ([src/bin/cli.ts](src/bin/cli.ts)), the standalone HTTP server ([src/http/server.ts](src/http/server.ts)), and the Vercel function ([api/mcp.ts](api/mcp.ts)) — so the tool surface never drifts between local and hosted modes. See the [design spec](docs/superpowers/specs/2026-06-30-umami-analytics-mcp-design.md).

## License

[MIT](LICENSE) © Mateusz Siatrak
