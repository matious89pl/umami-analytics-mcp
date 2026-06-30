import { redactString } from "../util/redact";
import { registerSecret } from "../util/redact";
import { UmamiApiError, UmamiAuthError, UmamiConfigError, UmamiNetworkError } from "./errors";
import {
  DEFAULT_BACKOFF,
  NoopLimiter,
  SlidingWindowLimiter,
  backoffMs,
  parseRetryAfter,
  sleep,
  type BackoffOptions,
  type Limiter,
} from "./rateLimit";
import { SERVER_NAME, VERSION } from "../version";
import type { AuthConfig, Deployment, MeResponse } from "./types";

export interface UmamiClientOptions {
  /** Fully-resolved base, incl. `/api` (self-hosted) or `/v1[/region]` (Cloud). */
  baseUrl: string;
  auth: AuthConfig;
  deployment: Deployment;
  teamId?: string;
  /** Override for the event-ingestion endpoint (`/api/send`). */
  sendUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  backoff?: BackoffOptions;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. */
  now?: () => number;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  /** Re-authenticate + retry once on 401 (login mode). Default true. */
  retryAuth?: boolean;
  /** Retry on 429/5xx/network. Defaults to true for GET/DELETE. */
  retryIdempotent?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_USER_AGENT = `${SERVER_NAME}/${VERSION}`;
/** Stay under Cloud's ~50/15s with headroom. */
const CLOUD_RATE = { max: 45, windowMs: 15_000 };

export class UmamiClient {
  private token: string | undefined;
  private loginInFlight: Promise<void> | undefined;
  private readonly limiter: Limiter;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly backoff: BackoffOptions;
  private readonly now: () => number;

  constructor(private readonly opts: UmamiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.now = opts.now ?? Date.now;
    this.limiter =
      opts.deployment === "cloud"
        ? new SlidingWindowLimiter(CLOUD_RATE.max, CLOUD_RATE.windowMs)
        : new NoopLimiter();
    if (!this.fetchImpl) {
      throw new UmamiConfigError("global fetch is unavailable — Node >= 20 is required");
    }
  }

  get deployment(): Deployment {
    return this.opts.deployment;
  }

  get teamId(): string | undefined {
    return this.opts.teamId;
  }

  // ── Convenience verbs ──────────────────────────────────────────────────────

  get<T = unknown>(path: string, query?: QueryParams, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, { ...options, query });
  }

  post<T = unknown>(path: string, body?: unknown, query?: QueryParams): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  del<T = unknown>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }

  /** Current user/profile. Used for token validation and capability detection. */
  getMe(): Promise<MeResponse> {
    return this.get<MeResponse>("/me");
  }

  // ── Authentication ─────────────────────────────────────────────────────────

  /** Ensure a bearer token exists (login mode only). Idempotent & deduplicated. */
  async ensureToken(): Promise<void> {
    if (this.opts.auth.kind !== "login" || this.token) return;
    await this.login();
  }

  private async login(): Promise<void> {
    if (this.opts.auth.kind !== "login") return;
    // Deduplicate concurrent logins.
    if (this.loginInFlight) return this.loginInFlight;
    const { username, password } = this.opts.auth;
    this.loginInFlight = (async () => {
      const url = this.buildUrl("/auth/login");
      const res = await this.rawFetch("POST", url, {
        headers: { "content-type": "application/json", "user-agent": this.userAgent() },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await safeText(res);
        throw new UmamiAuthError({
          status: res.status,
          path: pathOnly(url),
          message: `Umami login failed (${res.status}) — check UMAMI_USERNAME / UMAMI_PASSWORD`,
          code: extractCode(body),
          bodyExcerpt: truncate(body, 200),
        });
      }
      const data = (await parseJson(res)) as { token?: string };
      if (!data?.token) throw new UmamiConfigError("Umami login returned no token");
      this.token = data.token;
      registerSecret(data.token); // scrub the bearer from any future log/output
    })();
    try {
      await this.loginInFlight;
    } finally {
      this.loginInFlight = undefined;
    }
  }

  private userAgent(): string {
    return this.opts.userAgent ?? DEFAULT_USER_AGENT;
  }

  private authHeaders(): Record<string, string> {
    if (this.opts.auth.kind === "apiKey") return { "x-umami-api-key": this.opts.auth.apiKey };
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }

  // ── Core request pipeline ──────────────────────────────────────────────────

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (this.opts.auth.kind === "login") await this.ensureToken();

    const url = this.buildUrl(path, options.query);
    const idempotent = method === "GET" || method === "DELETE";
    const allowRetry = options.retryIdempotent ?? idempotent;
    let retryAuth = options.retryAuth ?? true;
    let attempt = 0;

    for (;;) {
      await this.limiter.acquire(this.now());

      let res: Response;
      try {
        res = await this.rawFetch(method, url, {
          headers: {
            ...this.authHeaders(),
            "user-agent": this.userAgent(),
            ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: options.signal,
        });
      } catch (err) {
        if (allowRetry && attempt < this.backoff.retries) {
          await sleep(backoffMs(attempt, this.backoff));
          attempt += 1;
          continue;
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new UmamiNetworkError(redactString(`Request to ${pathOnly(url)} failed: ${reason}`));
      }

      if (res.ok) return (await parseJson(res)) as T;

      // Expired/invalid bearer → re-auth once, then retry (login mode only).
      if (res.status === 401 && this.opts.auth.kind === "login" && retryAuth && this.token) {
        this.token = undefined;
        retryAuth = false;
        await this.login();
        continue;
      }

      // Transient → backoff retry (idempotent only).
      if ((res.status === 429 || res.status >= 500) && allowRetry && attempt < this.backoff.retries) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"), this.now());
        await sleep(backoffMs(attempt, this.backoff, retryAfter));
        attempt += 1;
        continue;
      }

      throw await this.toError(res, url);
    }
  }

  /** Event ingestion (`POST /api/send`): no auth header, real User-Agent required. */
  async sendCollect(
    type: "event" | "identify" | "performance",
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const url = this.opts.sendUrl ?? this.buildUrl("/send");
    await this.limiter.acquire(this.now());
    const res = await this.rawFetch("POST", url, {
      headers: { "content-type": "application/json", "user-agent": this.userAgent() },
      body: JSON.stringify({ type, payload }),
    });
    if (!res.ok) throw await this.toError(res, url);
    return parseJson(res);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private buildUrl(path: string, query?: QueryParams): string {
    const base = this.opts.baseUrl.replace(/\/+$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(base + suffix);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async rawFetch(
    method: string,
    url: string,
    init: { headers: Record<string, string>; body?: string; signal?: AbortSignal },
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal =
      init.signal !== undefined
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;
    try {
      return await this.fetchImpl(url, {
        method,
        headers: init.headers,
        body: init.body,
        signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async toError(res: Response, url: string): Promise<UmamiApiError> {
    const body = await safeText(res);
    const code = extractCode(body);
    const path = pathOnly(url);
    const Cls = res.status === 401 || res.status === 403 ? UmamiAuthError : UmamiApiError;
    const hint =
      res.status === 401 || res.status === 403
        ? " (token invalid/expired, or this account lacks permission for this resource/section)"
        : "";
    return new Cls({
      status: res.status,
      path,
      message: `Umami API responded ${res.status} on ${path}${hint}`,
      code,
      bodyExcerpt: truncate(body, 300),
    });
  }
}

// ── Module helpers ───────────────────────────────────────────────────────────

function pathOnly(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await safeText(res);
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text; // some endpoints return plain strings
  }
}

function extractCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    return typeof parsed.code === "string" ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
