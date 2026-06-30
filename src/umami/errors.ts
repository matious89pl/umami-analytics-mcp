import { redactString } from "../util/redact";

/** Bad input from the caller (invalid date, missing arg, etc.). */
export class UmamiInputError extends Error {
  override readonly name = "UmamiInputError";
}

/** Misconfiguration (missing/contradictory credentials or settings). */
export class UmamiConfigError extends Error {
  override readonly name = "UmamiConfigError";
}

/**
 * A non-OK HTTP response from the Umami API. The message is always redacted, and
 * we keep only the path (never the query string, which could carry tokens).
 */
export class UmamiApiError extends Error {
  override readonly name: string = "UmamiApiError";
  readonly status: number;
  readonly path: string;
  readonly code: string | undefined;
  readonly bodyExcerpt: string | undefined;

  constructor(args: {
    status: number;
    path: string;
    message: string;
    code?: string;
    bodyExcerpt?: string;
  }) {
    super(redactString(args.message));
    this.status = args.status;
    this.path = args.path;
    this.code = args.code;
    this.bodyExcerpt = args.bodyExcerpt ? redactString(args.bodyExcerpt) : undefined;
  }
}

/** 401/403 — token invalid/expired or section not permitted for this account. */
export class UmamiAuthError extends UmamiApiError {
  override readonly name = "UmamiAuthError";
}

/** Request timed out / network failure. */
export class UmamiNetworkError extends Error {
  override readonly name = "UmamiNetworkError";
}
