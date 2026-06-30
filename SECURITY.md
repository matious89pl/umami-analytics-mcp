# Security

`umami-analytics-mcp` gives an LLM control over a Umami analytics instance. It is built so that control is **bounded, auditable, and credential-safe** by default.

## Threat model

The server sits between an MCP client (an LLM) and your Umami API, holding your Umami credentials. The risks it defends against:

1. **Credential leakage** — a token ending up in a log, an error message, a tool result, or the model's context.
2. **Over-broad authority** — the model performing destructive or administrative actions you didn't intend.
3. **Unauthorized remote access** — when hosted, someone other than you driving the endpoint.
4. **Trusting a third party with your credentials** — handing your Umami login to someone else's hosted MCP server.

## How each is addressed

### Credentials never leak

- **Env-only.** Credentials are read from environment variables. They are never accepted as tool arguments or CLI flags, and never written to disk. The self-hosted bearer token is held in memory for the process lifetime and re-fetched on `401`.
- **Two-layer redaction.** A redaction utility scrubs secrets (a) by key — anything matching `password`/`token`/`authKey`/`api[-_]key`/`authorization`/`x-umami-api-key`/… — and (b) by literal value: the actual secret strings are registered at startup and stripped from every log line, error, and tool result, even if an upstream API reflects them back.
- **Sanitized identity.** `get_me` and all user/admin responses are passed through redaction, removing `token`, `authKey`, and `shareToken` before they reach the model.
- **stdout discipline.** Over stdio, stdout is the JSON-RPC channel; all diagnostics go to stderr.

### Least privilege by default

- The server is **read-only** unless you set `UMAMI_ENABLE_WRITE=1` (mutations) or `UMAMI_ENABLE_ADMIN=1` (user administration, self-hosted only).
- **Delete/reset** tools require *both* the relevant tier *and* `UMAMI_ALLOW_DESTRUCTIVE=1`, and carry MCP `destructiveHint` annotations so clients can prompt for confirmation.
- Only enabled-tier tools are registered, so a read-only deployment doesn't even advertise mutating tools. Umami's own RBAC remains the final authority.

### Remote endpoints are gated and fail closed

- The Vercel function and the standalone HTTP server require `MCP_AUTH_TOKEN`. Tokens are compared in **constant time**. If `MCP_AUTH_TOKEN` is unset, **every request is rejected** — the endpoint never runs open by accident.
- Recommended defense-in-depth when hosting on Vercel: enable **Deployment Protection** and the **Firewall**. For the standalone server, set `MCP_ALLOWED_HOSTS` to enable DNS-rebinding protection and keep it behind your own network controls.

### Don't hand your credentials to a third party

This server is designed to be **run by you, for your instance**. Do not point your Umami credentials at an MCP endpoint operated by someone else — doing so discloses your analytics login to that operator. There is intentionally no shared, hosted instance.

## Reporting a vulnerability

Please report security issues privately to the maintainer (see `package.json` `author`) rather than opening a public issue. Include reproduction steps and impact. You'll get an acknowledgement and a fix timeline.

## Operator checklist

- [ ] Credentials provided via env vars / your client's secret store — not committed.
- [ ] Started read-only; enabled `write`/`admin`/`destructive` only as needed.
- [ ] For remote hosting: strong random `MCP_AUTH_TOKEN` set; Deployment Protection / Firewall on.
- [ ] Using your own deployment — not a third party's.
