import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import type { UmamiContext } from "../server";
import { ok } from "../util/output";
import { reg, websiteIdShape } from "./shared";

const TEAM_ROLES = ["team-owner", "team-manager", "team-member", "team-view-only"] as const;

/** Write-tier tools (create/update + event ingestion). Destructive tools
 * (delete/reset) are registered only when the destructive tier is also on. */
export function registerWriteTools(server: McpServer, ctx: UmamiContext): void {
  const u = ctx.umami;

  // ── Websites ───────────────────────────────────────────────────────────────
  reg(
    server,
    "create_website",
    {
      title: "Create website",
      description: "Create a new website to track. Returns the new website (including its ID and tracking shareId).",
      inputSchema: {
        name: z.string().min(1).describe("Display name."),
        domain: z.string().min(1).describe("Domain, e.g. example.com."),
        teamId: z.string().optional().describe("Assign to a team."),
        shareId: z.string().optional().describe("Public share slug (optional)."),
      },
      outputSchema: { website: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const website = await u.post("/websites", {
        name: args.name,
        domain: args.domain,
        teamId: args.teamId,
        shareId: args.shareId,
      });
      return ok({ website }, `Created website "${args.name}" (${args.domain}).`);
    },
  );

  reg(
    server,
    "update_website",
    {
      title: "Update website",
      description: "Update a website's name, domain, or public share slug.",
      inputSchema: {
        ...websiteIdShape,
        name: z.string().optional(),
        domain: z.string().optional(),
        shareId: z.string().nullable().optional().describe("Set null to disable public sharing."),
      },
      outputSchema: { website: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const website = await u.post(`/websites/${encodeURIComponent(args.websiteId)}`, {
        name: args.name,
        domain: args.domain,
        shareId: args.shareId,
      });
      return ok({ website }, `Updated website ${args.websiteId}.`);
    },
  );

  reg(
    server,
    "manage_website_share",
    {
      title: "Manage website share link",
      description: "Enable or disable a website's public share link. When enabling, a random slug is generated unless you provide one.",
      inputSchema: {
        ...websiteIdShape,
        enabled: z.boolean().describe("true to enable a public share URL, false to disable."),
        shareId: z.string().optional().describe("Custom share slug (only when enabling)."),
      },
      outputSchema: { website: z.unknown(), shareId: z.string().nullable() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const shareId = args.enabled ? args.shareId ?? randomBytes(8).toString("hex") : null;
      const website = await u.post(`/websites/${encodeURIComponent(args.websiteId)}`, { shareId });
      return ok(
        { website, shareId },
        args.enabled ? `Share link enabled (slug: ${shareId}).` : "Share link disabled.",
      );
    },
  );

  reg(
    server,
    "transfer_website",
    {
      title: "Transfer website",
      description: "Transfer website ownership to another user or team. Provide exactly one of userId or teamId.",
      inputSchema: {
        ...websiteIdShape,
        userId: z.string().optional(),
        teamId: z.string().optional(),
      },
      outputSchema: { website: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const website = await u.post(`/websites/${encodeURIComponent(args.websiteId)}/transfer`, {
        userId: args.userId,
        teamId: args.teamId,
      });
      return ok({ website }, `Transferred website ${args.websiteId}.`);
    },
  );

  // ── Event ingestion ────────────────────────────────────────────────────────
  reg(
    server,
    "send_event",
    {
      title: "Send event",
      description:
        "Send a tracking payload to Umami's collection endpoint (POST /api/send) — useful for testing tracking or server-side events. type 'event' (named custom event), 'identify' (attach traits via id+data), or 'performance' (web vitals).",
      inputSchema: {
        ...websiteIdShape,
        type: z.enum(["event", "identify", "performance"]).optional().describe("Default 'event'."),
        name: z.string().optional().describe("Event name (type='event')."),
        url: z.string().optional().describe("Page path, e.g. /pricing."),
        hostname: z.string().optional(),
        referrer: z.string().optional(),
        title: z.string().optional(),
        language: z.string().optional(),
        screen: z.string().optional().describe("e.g. 1920x1080."),
        tag: z.string().optional(),
        id: z.string().optional().describe("Distinct id (type='identify')."),
        data: z.record(z.string(), z.unknown()).optional().describe("Custom properties / identify traits / web-vitals."),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        website: args.websiteId,
        name: args.name,
        url: args.url,
        hostname: args.hostname,
        referrer: args.referrer,
        title: args.title,
        language: args.language,
        screen: args.screen,
        tag: args.tag,
        id: args.id,
        data: args.data,
      };
      const data = await u.sendCollect(args.type ?? "event", payload);
      return ok({ data }, `Sent ${args.type ?? "event"}${args.name ? ` "${args.name}"` : ""}.`);
    },
  );

  // ── Teams ──────────────────────────────────────────────────────────────────
  reg(
    server,
    "create_team",
    {
      title: "Create team",
      description: "Create a team. Returns the team including its accessCode (share it so others can join).",
      inputSchema: { name: z.string().min(1) },
      outputSchema: { team: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const team = await u.post("/teams", { name: args.name });
      return ok({ team }, `Created team "${args.name}".`);
    },
  );

  reg(
    server,
    "update_team",
    {
      title: "Update team",
      description: "Rename a team or rotate its access code.",
      inputSchema: {
        teamId: z.string().min(1),
        name: z.string().optional(),
        accessCode: z.string().optional(),
      },
      outputSchema: { team: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const team = await u.post(`/teams/${encodeURIComponent(args.teamId)}`, {
        name: args.name,
        accessCode: args.accessCode,
      });
      return ok({ team }, `Updated team ${args.teamId}.`);
    },
  );

  reg(
    server,
    "join_team",
    {
      title: "Join team",
      description: "Join a team using its access code.",
      inputSchema: { accessCode: z.string().min(1) },
      outputSchema: { team: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const team = await u.post("/teams/join", { accessCode: args.accessCode });
      return ok({ team }, "Joined team.");
    },
  );

  reg(
    server,
    "add_team_member",
    {
      title: "Add team member",
      description: "Add a user to a team with a role.",
      inputSchema: {
        teamId: z.string().min(1),
        userId: z.string().min(1),
        role: z.enum(TEAM_ROLES),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const data = await u.post(`/teams/${encodeURIComponent(args.teamId)}/users`, {
        userId: args.userId,
        role: args.role,
      });
      return ok({ data }, `Added user ${args.userId} to team as ${args.role}.`);
    },
  );

  reg(
    server,
    "update_team_member",
    {
      title: "Update team member role",
      description: "Change a team member's role.",
      inputSchema: {
        teamId: z.string().min(1),
        userId: z.string().min(1),
        role: z.enum(TEAM_ROLES),
      },
      outputSchema: { data: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const data = await u.post(
        `/teams/${encodeURIComponent(args.teamId)}/users/${encodeURIComponent(args.userId)}`,
        { role: args.role },
      );
      return ok({ data }, `Set ${args.userId}'s role to ${args.role}.`);
    },
  );

  // ── Segments ───────────────────────────────────────────────────────────────
  reg(
    server,
    "create_segment",
    {
      title: "Create segment/cohort",
      description: "Create a saved segment or cohort for a website. `parameters` carries the segment's filter definition.",
      inputSchema: {
        ...websiteIdShape,
        name: z.string().min(1),
        type: z.enum(["segment", "cohort"]).optional(),
        parameters: z.record(z.string(), z.unknown()).optional().describe("Segment definition (filters)."),
      },
      outputSchema: { segment: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const segment = await u.post(`/websites/${encodeURIComponent(args.websiteId)}/segments`, {
        name: args.name,
        type: args.type ?? "segment",
        parameters: args.parameters,
      });
      return ok({ segment }, `Created ${args.type ?? "segment"} "${args.name}".`);
    },
  );

  reg(
    server,
    "update_segment",
    {
      title: "Update segment/cohort",
      description: "Update a saved segment's name or definition.",
      inputSchema: {
        ...websiteIdShape,
        segmentId: z.string().min(1),
        name: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: { segment: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const segment = await u.post(
        `/websites/${encodeURIComponent(args.websiteId)}/segments/${encodeURIComponent(args.segmentId)}`,
        { name: args.name, parameters: args.parameters },
      );
      return ok({ segment }, `Updated segment ${args.segmentId}.`);
    },
  );

  // ── Saved reports ──────────────────────────────────────────────────────────
  reg(
    server,
    "create_report",
    {
      title: "Create saved report",
      description: "Save a report definition. `parameters` holds the report config; `type` is e.g. funnel | retention | journey.",
      inputSchema: {
        ...websiteIdShape,
        name: z.string().min(1),
        type: z.string().describe("Report type, e.g. funnel | retention | journey | utm."),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: { report: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const report = await u.post("/reports", {
        websiteId: args.websiteId,
        name: args.name,
        type: args.type,
        description: args.description,
        parameters: args.parameters,
      });
      return ok({ report }, `Created ${args.type} report "${args.name}".`);
    },
  );

  reg(
    server,
    "update_report",
    {
      title: "Update saved report",
      description: "Update a saved report's name, description, or parameters.",
      inputSchema: {
        reportId: z.string().min(1),
        name: z.string().optional(),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      },
      outputSchema: { report: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const report = await u.post(`/reports/${encodeURIComponent(args.reportId)}`, {
        name: args.name,
        description: args.description,
        parameters: args.parameters,
      });
      return ok({ report }, `Updated report ${args.reportId}.`);
    },
  );

  // ── Destructive (double-gated) ─────────────────────────────────────────────
  if (ctx.scopes.destructive) registerDestructiveWriteTools(server, ctx);
}

function registerDestructiveWriteTools(server: McpServer, ctx: UmamiContext): void {
  const u = ctx.umami;

  reg(
    server,
    "delete_website",
    {
      title: "Delete website",
      description: "PERMANENTLY delete a website and ALL its analytics data. Irreversible.",
      inputSchema: { ...websiteIdShape },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      await u.del(`/websites/${encodeURIComponent(args.websiteId)}`);
      return ok({ ok: true }, `Deleted website ${args.websiteId}.`);
    },
  );

  reg(
    server,
    "reset_website",
    {
      title: "Reset website data",
      description: "PERMANENTLY wipe ALL analytics data for a website while keeping the website itself. Irreversible.",
      inputSchema: { ...websiteIdShape },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      await u.post(`/websites/${encodeURIComponent(args.websiteId)}/reset`);
      return ok({ ok: true }, `Reset all data for website ${args.websiteId}.`);
    },
  );

  reg(
    server,
    "delete_team",
    {
      title: "Delete team",
      description: "PERMANENTLY delete a team. Irreversible.",
      inputSchema: { teamId: z.string().min(1) },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      await u.del(`/teams/${encodeURIComponent(args.teamId)}`);
      return ok({ ok: true }, `Deleted team ${args.teamId}.`);
    },
  );

  reg(
    server,
    "remove_team_member",
    {
      title: "Remove team member",
      description: "Remove a user from a team (or leave it).",
      inputSchema: { teamId: z.string().min(1), userId: z.string().min(1) },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      await u.del(`/teams/${encodeURIComponent(args.teamId)}/users/${encodeURIComponent(args.userId)}`);
      return ok({ ok: true }, `Removed ${args.userId} from team ${args.teamId}.`);
    },
  );

  reg(
    server,
    "delete_segment",
    {
      title: "Delete segment/cohort",
      description: "PERMANENTLY delete a saved segment/cohort. Irreversible.",
      inputSchema: { ...websiteIdShape, segmentId: z.string().min(1) },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      await u.del(
        `/websites/${encodeURIComponent(args.websiteId)}/segments/${encodeURIComponent(args.segmentId)}`,
      );
      return ok({ ok: true }, `Deleted segment ${args.segmentId}.`);
    },
  );

  reg(
    server,
    "delete_report",
    {
      title: "Delete saved report",
      description: "PERMANENTLY delete a saved report. Irreversible.",
      inputSchema: { reportId: z.string().min(1) },
      outputSchema: { ok: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      await u.del(`/reports/${encodeURIComponent(args.reportId)}`);
      return ok({ ok: true }, `Deleted report ${args.reportId}.`);
    },
  );
}
