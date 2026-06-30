import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";
import { num, ok } from "../util/output";
import { redact } from "../util/redact";
import { asCount, asList, paginationShape, reg } from "./shared";

const USER_ROLES = ["admin", "user", "view-only"] as const;
const userIdShape = { userId: z.string().min(1).describe("Umami user ID.") } as const;

/** Admin-tier tools: instance user administration. Self-hosted only — the
 * server never registers these on Umami Cloud (capability-gated upstream). */
export function registerAdminTools(server: McpServer, ctx: UmamiContext): void {
  const u = ctx.umami;

  reg(
    server,
    "list_users",
    {
      title: "List users",
      description: "List all users on the instance (admin only, self-hosted). Sensitive fields are stripped.",
      inputSchema: { ...paginationShape },
      outputSchema: { count: z.number(), data: z.array(z.unknown()) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const res = await u.get<unknown>("/users", {
        page: args.page,
        pageSize: args.pageSize,
        search: args.search,
      });
      const data = redact(asList(res));
      return ok({ count: asCount(res, data.length), data }, `${num(asCount(res, data.length))} user(s).`);
    },
  );

  reg(
    server,
    "get_user",
    {
      title: "Get user",
      description: "Fetch a single user by ID (admin only). Sensitive fields are stripped.",
      inputSchema: { ...userIdShape },
      outputSchema: { user: z.unknown() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const user = redact(await u.get(`/users/${encodeURIComponent(args.userId)}`));
      return ok({ user }, `User ${args.userId} retrieved.`);
    },
  );

  reg(
    server,
    "create_user",
    {
      title: "Create user",
      description: "Create a new instance user with a role (admin only). The password is write-only and never echoed back.",
      inputSchema: {
        username: z.string().min(1),
        password: z.string().min(1).describe("Initial password (write-only)."),
        role: z.enum(USER_ROLES),
      },
      outputSchema: { user: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      const user = redact(
        await u.post("/users", { username: args.username, password: args.password, role: args.role }),
      );
      return ok({ user }, `Created user "${args.username}" (${args.role}).`);
    },
  );

  reg(
    server,
    "update_user",
    {
      title: "Update user",
      description: "Update a user's username, password, or role (admin only). Provide only the fields to change.",
      inputSchema: {
        ...userIdShape,
        username: z.string().optional(),
        password: z.string().optional().describe("New password (write-only)."),
        role: z.enum(USER_ROLES).optional(),
      },
      outputSchema: { user: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const user = redact(
        await u.post(`/users/${encodeURIComponent(args.userId)}`, {
          username: args.username,
          password: args.password,
          role: args.role,
        }),
      );
      return ok({ user }, `Updated user ${args.userId}.`);
    },
  );

  reg(
    server,
    "set_user_role",
    {
      title: "Set user role",
      description: "Change a user's role (admin | user | view-only).",
      inputSchema: { ...userIdShape, role: z.enum(USER_ROLES) },
      outputSchema: { user: z.unknown() },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (args) => {
      const user = redact(await u.post(`/users/${encodeURIComponent(args.userId)}`, { role: args.role }));
      return ok({ user }, `Set user ${args.userId} role to ${args.role}.`);
    },
  );

  // ── Destructive (double-gated) ─────────────────────────────────────────────
  if (ctx.scopes.destructive) {
    reg(
      server,
      "delete_user",
      {
        title: "Delete user",
        description: "PERMANENTLY delete a user (admin only). Irreversible.",
        inputSchema: { ...userIdShape },
        outputSchema: { ok: z.boolean() },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args) => {
        await u.del(`/users/${encodeURIComponent(args.userId)}`);
        return ok({ ok: true }, `Deleted user ${args.userId}.`);
      },
    );
  }
}
