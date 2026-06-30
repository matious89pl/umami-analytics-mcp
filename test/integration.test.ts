import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type { ResolvedScopes } from "../src/capabilities";
import { createServer, type UmamiContext } from "../src/server";
import { UmamiClient } from "../src/umami/client";

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

function makeContext(fetchImpl: typeof fetch, scopes: ResolvedScopes = READ_ONLY): UmamiContext {
  const umami = new UmamiClient({
    baseUrl: "https://api.umami.is/v1",
    deployment: "cloud",
    auth: { kind: "apiKey", apiKey: "test-key" },
    fetchImpl,
  });
  return { umami, scopes, deployment: "cloud", defaults: { timezone: "UTC" } };
}

async function connect(ctx: UmamiContext): Promise<Client> {
  const server = createServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "integration-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

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
