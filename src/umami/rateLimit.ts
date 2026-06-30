/**
 * Client-side rate limiting & retry. Umami Cloud enforces ~50 requests / 15s per
 * API key (HTTP 429 on breach); self-hosted has no app-level limit. The client
 * uses a sliding-window limiter (Cloud only) plus exponential backoff on 429/5xx.
 */

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Sliding-window limiter: at most `max` acquisitions per `windowMs`. */
export class SlidingWindowLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Resolve immediately if under the limit, else wait until a slot frees up. */
  async acquire(now: number = Date.now()): Promise<void> {
    this.evict(now);
    if (this.hits.length < this.max) {
      this.hits.push(now);
      return;
    }
    const oldest = this.hits[0]!;
    const waitMs = oldest + this.windowMs - now;
    if (waitMs > 0) await sleep(waitMs);
    return this.acquire(Date.now());
  }

  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0 && this.hits[0]! <= cutoff) this.hits.shift();
  }
}

/** No-op limiter for self-hosted (no client-side throttling needed). */
export class NoopLimiter {
  async acquire(): Promise<void> {
    /* unlimited */
  }
}

export type Limiter = SlidingWindowLimiter | NoopLimiter;

export interface BackoffOptions {
  /** Max retry attempts after the first try. */
  retries: number;
  /** Base delay in ms (doubled each attempt). */
  baseMs: number;
  /** Ceiling for a single delay in ms. */
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { retries: 3, baseMs: 500, maxMs: 8000 };

/** Compute the delay before retry `attempt` (0-based), honoring Retry-After. */
export function backoffMs(attempt: number, opts: BackoffOptions, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
    return Math.min(opts.maxMs, Math.max(0, retryAfterMs));
  }
  return Math.min(opts.maxMs, opts.baseMs * 2 ** attempt);
}

/** Parse a `Retry-After` header (seconds or HTTP date) into ms, if present. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return secs * 1000;
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.max(0, when - now);
  return undefined;
}
