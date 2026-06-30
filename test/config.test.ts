import { afterEach, describe, expect, it } from "vitest";

import { loadConfig, parseFlags } from "../src/config";
import { UmamiConfigError } from "../src/umami/errors";
import { redactString, resetSecrets } from "../src/util/redact";

afterEach(() => resetSecrets());

const NO_ARGS: string[] = [];

describe("parseFlags", () => {
  it("parses value, =, and boolean flags", () => {
    expect(parseFlags(["--api-url", "https://x", "--team-id=t1", "--write"])).toEqual({
      "api-url": "https://x",
      "team-id": "t1",
      write: true,
    });
  });
});

describe("loadConfig — auth mode resolution", () => {
  it("selects Umami Cloud from an API key", () => {
    const cfg = loadConfig({ UMAMI_API_KEY: "key" }, NO_ARGS);
    expect(cfg.deployment).toBe("cloud");
    expect(cfg.baseUrl).toBe("https://api.umami.is/v1");
    expect(cfg.auth).toEqual({ kind: "apiKey", apiKey: "key" });
  });

  it("appends a validated cloud region", () => {
    const cfg = loadConfig({ UMAMI_API_KEY: "key", UMAMI_CLOUD_REGION: "eu" }, NO_ARGS);
    expect(cfg.baseUrl).toBe("https://api.umami.is/v1/eu");
  });

  it("rejects an invalid region", () => {
    expect(() => loadConfig({ UMAMI_API_KEY: "k", UMAMI_CLOUD_REGION: "mars" }, NO_ARGS)).toThrow(
      UmamiConfigError,
    );
  });

  it("selects self-hosted login mode and normalizes the host", () => {
    const cfg = loadConfig(
      { UMAMI_API_URL: "stats.example.com", UMAMI_USERNAME: "admin", UMAMI_PASSWORD: "pw" },
      NO_ARGS,
    );
    expect(cfg.deployment).toBe("self-hosted");
    expect(cfg.baseUrl).toBe("https://stats.example.com/api");
    expect(cfg.auth).toEqual({ kind: "login", username: "admin", password: "pw" });
  });

  it("supports self-hosted with an API key", () => {
    const cfg = loadConfig({ UMAMI_API_URL: "https://stats.example.com/", UMAMI_API_KEY: "k" }, NO_ARGS);
    expect(cfg.deployment).toBe("self-hosted");
    expect(cfg.baseUrl).toBe("https://stats.example.com/api");
    expect(cfg.auth).toEqual({ kind: "apiKey", apiKey: "k" });
  });

  it("throws actionable error when credentials are missing", () => {
    expect(() => loadConfig({}, NO_ARGS)).toThrow(UmamiConfigError);
  });
});

describe("loadConfig — scopes", () => {
  it("is read-only by default", () => {
    const cfg = loadConfig({ UMAMI_API_KEY: "k" }, NO_ARGS);
    expect(cfg.scopes).toMatchObject({ read: true, write: false, admin: false, destructive: false });
  });

  it("enables write via env and flags", () => {
    expect(loadConfig({ UMAMI_API_KEY: "k", UMAMI_ENABLE_WRITE: "1" }, NO_ARGS).scopes.write).toBe(true);
    expect(loadConfig({ UMAMI_API_KEY: "k" }, ["--write"]).scopes.write).toBe(true);
  });

  it("disables admin on Cloud with a note", () => {
    const cfg = loadConfig({ UMAMI_API_KEY: "k", UMAMI_ENABLE_ADMIN: "1" }, NO_ARGS);
    expect(cfg.scopes.admin).toBe(false);
    expect(cfg.scopes.notes.join(" ")).toMatch(/Cloud/);
  });

  it("keeps destructive inert without write/admin", () => {
    const cfg = loadConfig({ UMAMI_API_KEY: "k", UMAMI_ALLOW_DESTRUCTIVE: "1" }, NO_ARGS);
    expect(cfg.scopes.destructive).toBe(false);
  });

  it("activates destructive alongside write", () => {
    const cfg = loadConfig(
      { UMAMI_API_KEY: "k", UMAMI_ENABLE_WRITE: "1", UMAMI_ALLOW_DESTRUCTIVE: "1" },
      NO_ARGS,
    );
    expect(cfg.scopes.destructive).toBe(true);
  });
});

describe("loadConfig — value sanitization", () => {
  it("strips accidental surrounding quotes from the URL", () => {
    const cfg = loadConfig(
      { UMAMI_API_URL: '"https://stats.example.com"', UMAMI_USERNAME: "admin", UMAMI_PASSWORD: "pw" },
      NO_ARGS,
    );
    expect(cfg.baseUrl).toBe("https://stats.example.com/api");
  });

  it("strips quotes from a cloud API key", () => {
    const cfg = loadConfig({ UMAMI_API_KEY: "'mykey'" }, NO_ARGS);
    expect(cfg.auth).toEqual({ kind: "apiKey", apiKey: "mykey" });
  });

  it("keeps the password literal (does not dequote)", () => {
    const cfg = loadConfig(
      { UMAMI_API_URL: "https://x.com", UMAMI_USERNAME: "admin", UMAMI_PASSWORD: '"quoted-pw"' },
      NO_ARGS,
    );
    expect(cfg.auth).toEqual({ kind: "login", username: "admin", password: '"quoted-pw"' });
  });
});

describe("loadConfig — secret registration", () => {
  it("registers credentials for redaction", () => {
    loadConfig({ UMAMI_API_KEY: "top-secret-key" }, NO_ARGS);
    expect(redactString("here is top-secret-key")).toBe("here is [redacted]");
  });
});
