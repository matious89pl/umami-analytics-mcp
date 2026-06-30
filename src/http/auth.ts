import { timingSafeEqual } from "node:crypto";

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function extractBearer(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/**
 * Constant-time comparison of a presented token against the configured secret.
 * **Fails closed**: returns false when no secret is configured, so a remote
 * endpoint without `MCP_AUTH_TOKEN` rejects everything rather than running open.
 */
export function checkBearer(provided: string | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; guard first (length isn't secret).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
