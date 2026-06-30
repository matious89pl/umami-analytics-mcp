import { afterEach, describe, expect, it, vi } from "vitest";

import { UmamiClient } from "../src/umami/client";
import { UmamiApiError, UmamiAuthError, UmamiNetworkError } from "../src/umami/errors";
import { redactString, registerSecret, resetSecrets } from "../src/util/redact";

afterEach(() => resetSecrets());

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = data === undefined ? "" : JSON.stringify(data);
  return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}

/** Build a fake fetch driven by a router, capturing each request. */
function fakeFetch(
  router: (req: Captured, callIndex: number) => Response,
): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fn = (async (input: unknown, init: RequestInit = {}) => {
    const captured: Captured = {
      url: String(input),
      method: init.method ?? "GET",
      headers: (init.headers as Record<string, string>) ?? {},
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(captured);
    return router(captured, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

describe("UmamiClient — Cloud (API key)", () => {
  it("sends the x-umami-api-key header and parses JSON", async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse([{ id: "w1" }]));
    const client = new UmamiClient({
      baseUrl: "https://api.umami.is/v1",
      deployment: "cloud",
      auth: { kind: "apiKey", apiKey: "cloud-key-123" },
      fetchImpl: fetch,
    });

    const data = await client.get<{ id: string }[]>("/websites");
    expect(data).toEqual([{ id: "w1" }]);
    expect(calls[0]!.url).toBe("https://api.umami.is/v1/websites");
    expect(calls[0]!.headers["x-umami-api-key"]).toBe("cloud-key-123");
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
  });
});

describe("UmamiClient — self-hosted (login)", () => {
  it("logs in once then sends a Bearer token", async () => {
    const { fetch, calls } = fakeFetch((req) => {
      if (req.url.endsWith("/auth/login")) return jsonResponse({ token: "jwt-abc" });
      return jsonResponse({ ok: true });
    });
    const client = new UmamiClient({
      baseUrl: "https://stats.example.com/api",
      deployment: "self-hosted",
      auth: { kind: "login", username: "admin", password: "pw" },
      fetchImpl: fetch,
    });

    await client.get("/websites");
    await client.get("/me");

    const logins = calls.filter((c) => c.url.endsWith("/auth/login"));
    expect(logins).toHaveLength(1);
    expect(JSON.parse(logins[0]!.body!)).toEqual({ username: "admin", password: "pw" });
    const dataCalls = calls.filter((c) => !c.url.endsWith("/auth/login"));
    expect(dataCalls.every((c) => c.headers["authorization"] === "Bearer jwt-abc")).toBe(true);
  });

  it("re-authenticates and retries once on 401", async () => {
    let token = "jwt-1";
    const { fetch, calls } = fakeFetch((req) => {
      if (req.url.endsWith("/auth/login")) {
        token = token === "jwt-1" ? "jwt-1" : "jwt-2";
        return jsonResponse({ token });
      }
      // First data call (with jwt-1) → 401; after re-login, succeed.
      const auth = req.headers["authorization"];
      if (auth === "Bearer jwt-1") {
        token = "jwt-2";
        return jsonResponse({ code: "unauthorized" }, 401);
      }
      return jsonResponse({ ok: true });
    });
    const client = new UmamiClient({
      baseUrl: "https://stats.example.com/api",
      deployment: "self-hosted",
      auth: { kind: "login", username: "admin", password: "pw" },
      fetchImpl: fetch,
    });

    const result = await client.get<{ ok: boolean }>("/websites");
    expect(result).toEqual({ ok: true });
    const logins = calls.filter((c) => c.url.endsWith("/auth/login"));
    expect(logins).toHaveLength(2); // initial + re-auth
  });

  it("surfaces a UmamiAuthError when login credentials are wrong", async () => {
    const { fetch } = fakeFetch(() => jsonResponse({ code: "incorrect-username-password" }, 401));
    const client = new UmamiClient({
      baseUrl: "https://stats.example.com/api",
      deployment: "self-hosted",
      auth: { kind: "login", username: "admin", password: "wrong" },
      fetchImpl: fetch,
    });
    await expect(client.get("/websites")).rejects.toBeInstanceOf(UmamiAuthError);
  });
});

describe("UmamiClient — resilience & redaction", () => {
  it("retries on 429 then succeeds", async () => {
    const { fetch, calls } = fakeFetch((_req, i) =>
      i === 0 ? jsonResponse({ code: "rate" }, 429, { "retry-after": "0" }) : jsonResponse({ ok: 1 }),
    );
    const client = new UmamiClient({
      baseUrl: "https://api.umami.is/v1",
      deployment: "cloud",
      auth: { kind: "apiKey", apiKey: "k" },
      fetchImpl: fetch,
      backoff: { retries: 2, baseMs: 1, maxMs: 2 },
    });
    await expect(client.get("/websites")).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("never leaks the API key in a surfaced error", async () => {
    registerSecret("cloud-key-SECRET");
    const { fetch } = fakeFetch(() =>
      jsonResponse({ message: "rejected key cloud-key-SECRET", code: "bad" }, 500),
    );
    const client = new UmamiClient({
      baseUrl: "https://api.umami.is/v1",
      deployment: "cloud",
      auth: { kind: "apiKey", apiKey: "cloud-key-SECRET" },
      fetchImpl: fetch,
      backoff: { retries: 0, baseMs: 1, maxMs: 1 },
    });
    const err = await client.get("/websites").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UmamiApiError);
    const serialized = JSON.stringify({
      message: (err as UmamiApiError).message,
      body: (err as UmamiApiError).bodyExcerpt,
    });
    expect(serialized).not.toContain("cloud-key-SECRET");
    expect(redactString("cloud-key-SECRET")).toBe("[redacted]");
  });

  it("wraps network failures as UmamiNetworkError", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED 127.0.0.1");
    }) as unknown as typeof fetch;
    const client = new UmamiClient({
      baseUrl: "https://stats.example.com/api",
      deployment: "self-hosted",
      auth: { kind: "apiKey", apiKey: "k" },
      fetchImpl,
      backoff: { retries: 0, baseMs: 1, maxMs: 1 },
    });
    await expect(client.get("/websites")).rejects.toBeInstanceOf(UmamiNetworkError);
  });
});
