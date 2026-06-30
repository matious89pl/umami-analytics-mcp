import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type { ResolvedScopes } from "../src/capabilities";
import { createServer, type UmamiContext } from "../src/server";
import { UmamiClient } from "../src/umami/client";
import { registerSecret, resetSecrets } from "../src/util/redact";

const READ_ONLY: ResolvedScopes = {
  read: true,
  write: false,
  admin: false,
  destructive: false,
  notes: [],
};

function jsonFetch(data: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

type Deployment = "cloud" | "self-hosted";

function makeContext(
  fetchImpl: typeof fetch,
  scopes: ResolvedScopes = READ_ONLY,
  deployment: Deployment = "cloud",
): UmamiContext {
  const umami = new UmamiClient({
    baseUrl: deployment === "cloud" ? "https://api.umami.is/v1" : "https://stats.example.com/api",
    deployment,
    auth: { kind: "apiKey", apiKey: "test-key" },
    fetchImpl,
    backoff: { retries: 0, baseMs: 1, maxMs: 1 }, // keep error-path tests fast
  });
  return { umami, scopes, deployment, defaults: { timezone: "UTC" } };
}

async function connect(ctx: UmamiContext): Promise<Client> {
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "integration-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function toolNames(scopes: ResolvedScopes, deployment: Deployment = "cloud"): Promise<string[]> {
  const client = await connect(makeContext(jsonFetch([]), scopes, deployment));
  return (await client.listTools()).tools.map((t) => t.name);
}

const scopes = (over: Partial<ResolvedScopes>): ResolvedScopes => ({ ...READ_ONLY, ...over });

describe("MCP server integration (in-memory)", () => {
  it("advertises read tools", async () => {
    const client = await connect(makeContext(jsonFetch([])));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_websites");
    expect(names).toContain("get_website");
    expect(names).toContain("get_website_daterange");
  });

  it("returns a text summary and structuredContent from a tool call", async () => {
    const fetchImpl = jsonFetch([{ id: "w1", name: "My Site", domain: "example.com" }]);
    const client = await connect(makeContext(fetchImpl));
    const res = await client.callTool({ name: "list_websites", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ count: 1 });
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain("My Site");
  });
});

describe("capability tier gating", () => {
  it("read-only excludes all write and admin tools", async () => {
    const names = await toolNames(READ_ONLY);
    expect(names).not.toContain("create_website");
    expect(names).not.toContain("delete_website");
    expect(names).not.toContain("send_event");
    expect(names).not.toContain("list_users");
  });

  it("write tier adds mutations but NOT destructive tools", async () => {
    const names = await toolNames(scopes({ write: true }));
    expect(names).toContain("create_website");
    expect(names).toContain("send_event");
    expect(names).not.toContain("delete_website"); // destructive still gated
    expect(names).not.toContain("reset_website");
  });

  it("destructive tier (with write) exposes delete/reset", async () => {
    const names = await toolNames(scopes({ write: true, destructive: true }));
    expect(names).toContain("delete_website");
    expect(names).toContain("reset_website");
  });

  it("admin tier (self-hosted) exposes user administration", async () => {
    const names = await toolNames(scopes({ admin: true }), "self-hosted");
    expect(names).toContain("list_users");
    expect(names).toContain("create_user");
    expect(names).not.toContain("delete_user"); // destructive still gated
  });

  it("admin + destructive exposes delete_user", async () => {
    const names = await toolNames(scopes({ admin: true, destructive: true }), "self-hosted");
    expect(names).toContain("delete_user");
  });
});

describe("end-to-end tool behavior", () => {
  it("send_event posts the correct /send payload with a User-Agent", async () => {
    let captured: { url: string; body: unknown; headers: Record<string, string> } | undefined;
    const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
      captured = {
        url: String(url),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        headers: (init.headers as Record<string, string>) ?? {},
      };
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = await connect(makeContext(fetchImpl, scopes({ write: true })));
    const res = await client.callTool({
      name: "send_event",
      arguments: { websiteId: "w1", name: "signup", url: "/pricing", data: { plan: "pro" } },
    });

    expect(res.isError).toBeFalsy();
    expect(captured?.url).toContain("/send");
    expect(captured?.body).toMatchObject({
      type: "event",
      payload: { website: "w1", name: "signup", url: "/pricing", data: { plan: "pro" } },
    });
    expect(captured?.headers["user-agent"]).toBeTruthy();
  });

  it("report_funnel posts the Umami v3 body shape (type + parameters, ISO dates, path steps)", async () => {
    let captured: { url: string; json: Record<string, unknown> } | undefined;
    const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
      captured = {
        url: String(url),
        json: typeof init.body === "string" ? JSON.parse(init.body) : {},
      };
      return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const client = await connect(makeContext(fetchImpl));
    const res = await client.callTool({
      name: "report_funnel",
      arguments: {
        websiteId: "w1",
        range: "7d",
        steps: [
          { type: "url", value: "/" },
          { type: "event", value: "export_completed" },
        ],
      },
    });

    expect(res.isError).toBeFalsy();
    expect(captured?.url).toContain("/reports/funnel");
    const body = captured!.json as {
      type: string;
      websiteId: string;
      filters: unknown;
      parameters: { startDate: unknown; endDate: unknown; steps: Array<{ type: string }> };
    };
    expect(body.type).toBe("funnel");
    expect(body.websiteId).toBe("w1");
    expect(typeof body.filters).toBe("object");
    expect(typeof body.parameters.startDate).toBe("string"); // ISO, not epoch
    expect(typeof body.parameters.endDate).toBe("string");
    expect(body.parameters.steps[0]!.type).toBe("path"); // 'url' alias mapped to 'path'
    expect(body.parameters.steps[1]!.type).toBe("event");
  });

  it("returns tool errors as isError and never leaks the API key", async () => {
    registerSecret("test-key"); // the apiKey used by makeContext
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "rejected key test-key", code: "x" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const client = await connect(makeContext(fetchImpl));
    const res = await client.callTool({ name: "list_websites", arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).not.toContain("test-key");
    resetSecrets();
  });
});
