# umami-analytics-mcp

> Security-first [Model Context Protocol](https://modelcontextprotocol.io) server for [Umami](https://umami.is) analytics — **Cloud and self-hosted**. Set up, analyze, report, and (when you allow it) administer your Umami instance from any MCP client.

**Status:** under active construction. See [the design spec](docs/superpowers/specs/2026-06-30-umami-analytics-mcp-design.md) for the full architecture. A complete README (quickstart, client configs, Vercel deploy, tool reference) lands with Phase 7.

## Highlights

- **Local-first:** `npx umami-analytics-mcp` over stdio — no build step.
- **Deploy to Vercel:** same codebase, auth-gated Streamable-HTTP endpoint via `mcp-handler`.
- **Safe by default:** read-only unless you opt into `write` / `admin` tiers; destructive ops double-gated. Credentials live in env only — never in tool arguments, outputs, or logs.
- **Comprehensive:** full Umami v3 surface — stats, metrics, events, sessions, **reports** (funnel/retention/journey/attribution/revenue/UTM/web-vitals), segments, teams, share links, event ingestion, and self-hosted user administration.

## License

[MIT](LICENSE) © Mateusz Siatrak
