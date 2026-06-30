/**
 * Secret redaction — the backbone of the "credentials are never leaked" guarantee.
 *
 * Two independent layers of defense:
 *   1. **Key-based**: any object key that looks like a credential is masked,
 *      regardless of its value.
 *   2. **Literal-based**: the actual secret values are registered at config load
 *      (see config.ts) and scrubbed wherever they appear — even if an upstream
 *      Umami error reflects the token back inside a message body.
 *
 * Everything written to stderr, or surfaced in a tool result or error, MUST pass
 * through {@link redact} / {@link redactString} first.
 */

const SENSITIVE_KEY_RE =
  /^(?:password|passwd|pass|token|access[_-]?token|refresh[_-]?token|auth[_-]?key|share[_-]?token|api[_-]?key|authorization|x-umami-api-key|cookie|set-cookie|secret|client[_-]?secret|credentials?)$/i;

const MASK = "[redacted]";

/** Live registry of literal secret values to scrub from any string. */
const knownSecrets = new Set<string>();

/** Register a literal secret so it is scrubbed anywhere it later appears. */
export function registerSecret(value: string | undefined | null): void {
  // Ignore trivially short values to avoid masking innocuous substrings.
  if (typeof value === "string" && value.length >= 4) knownSecrets.add(value);
}

/** Clear the secret registry (used by tests). */
export function resetSecrets(): void {
  knownSecrets.clear();
}

/** Replace every registered secret literal in a string with the mask. */
export function redactString(input: string): string {
  let out = input;
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(MASK);
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-redact a value: masks sensitive keys, scrubs secret literals from every
 * string, and returns a NEW structure (never mutates the input). Non-plain
 * objects (Date, etc.) are returned untouched.
 */
export function redact<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen)) as unknown as T;
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? MASK : redact(val, seen);
  }
  return out as unknown as T;
}
