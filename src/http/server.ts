import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer } from "../server";
import type { UmamiContext } from "../server";
import { checkBearer, extractBearer } from "./auth";

export interface HttpServerOptions {
  port: number;
  host: string;
  /** Endpoint path for the MCP transport (default "/mcp"). */
  path?: string;
  /** Shared-secret bearer required on each request (unless requireAuth=false). */
  authToken?: string;
  /** When false, the endpoint runs WITHOUT auth (localhost dev only). */
  requireAuth?: boolean;
  /** Hosts allowed by DNS-rebinding protection; when set, protection is on. */
  allowedHosts?: string[];
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

/**
 * Standalone Streamable-HTTP MCP server for Docker / self-hosting (no framework).
 * Stateless: each request gets a fresh server+transport. Bearer-gated by default
 * (fails closed). Reuses the same shared core as the stdio and Vercel transports.
 */
export function startHttpServer(ctx: UmamiContext, options: HttpServerOptions): Server {
  const path = options.path ?? "/mcp";
  const requireAuth = options.requireAuth ?? true;

  const httpServer = createHttpServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
      } else {
        res.end();
      }
      console.error("http handler error:", err instanceof Error ? err.message : err);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname !== path) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    if (requireAuth && !checkBearer(extractBearer(req.headers.authorization), options.authToken)) {
      res.writeHead(401, { "content-type": "application/json", "www-authenticate": "Bearer" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
      return;
    }

    const body = await readJsonBody(req);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true, // request/response tools — no server-initiated streaming needed
      ...(options.allowedHosts && options.allowedHosts.length > 0
        ? { enableDnsRebindingProtection: true, allowedHosts: options.allowedHosts }
        : {}),
    });
    const server = createServer(ctx);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  httpServer.listen(options.port, options.host);
  return httpServer;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return undefined;
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
