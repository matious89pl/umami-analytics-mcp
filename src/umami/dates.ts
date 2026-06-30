import { UmamiInputError } from "./errors";

/**
 * Date & range normalization — centralized so the millisecond/second footgun is
 * handled in exactly one place:
 *   - Umami stats endpoints take `startAt`/`endAt` as **epoch milliseconds**.
 *   - `POST /api/send` takes `payload.timestamp` as **epoch seconds**.
 *
 * Numeric inputs are interpreted as epoch **milliseconds** (matching the stats
 * API). Relative presets are computed in **UTC**; pass explicit `startAt`/`endAt`
 * plus a `timezone` query param when you need calendar boundaries in a local tz.
 */

export interface DateRangeInput {
  /** Shorthand preset, e.g. "7d", "24h", "today", "this-month". Default "7d". */
  range?: string;
  /** Explicit start: ISO string, "YYYY-MM-DD", or epoch ms. Overrides `range`. */
  startAt?: string | number;
  /** Explicit end: ISO string, "YYYY-MM-DD", or epoch ms. Defaults to now. */
  endAt?: string | number;
}

export interface ResolvedRange {
  /** Epoch milliseconds. */
  startAt: number;
  /** Epoch milliseconds. */
  endAt: number;
}

const DAY_MS = 86_400_000;

/** Parse an ISO string, "YYYY-MM-DD", numeric string, or number into epoch ms. */
export function parseInstant(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new UmamiInputError(`Invalid timestamp: ${value}`);
    return Math.trunc(value);
  }
  const s = value.trim();
  if (s === "") throw new UmamiInputError("Empty date string");
  if (/^\d+$/.test(s)) return Math.trunc(Number(s));
  const t = Date.parse(s);
  if (Number.isNaN(t)) {
    throw new UmamiInputError(`Unrecognized date: "${value}" (use ISO 8601, YYYY-MM-DD, or epoch ms)`);
  }
  return t;
}

/** Convert epoch milliseconds to epoch seconds (for `/api/send`). */
export function msToSeconds(ms: number): number {
  return Math.trunc(ms / 1000);
}

const RELATIVE_RE = /^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mo|mon|months?|y|yr|yrs|years?)$/;

function startOfUTCDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfUTCWeek(ms: number): number {
  // ISO week: Monday start.
  const day = startOfUTCDay(ms);
  const dow = new Date(day).getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7;
  return day - sinceMonday * DAY_MS;
}

function startOfUTCMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function startOfUTCYear(ms: number): number {
  return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
}

function addUTCMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
}

function resolvePreset(raw: string, now: number): ResolvedRange {
  const preset = raw.trim().toLowerCase();

  const rel = RELATIVE_RE.exec(preset);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!;
    let startAt: number;
    if (/^m(in)?/.test(unit) && unit !== "mo" && unit !== "mon" && !unit.startsWith("month")) {
      startAt = now - n * 60_000;
    } else if (unit.startsWith("h")) {
      startAt = now - n * 3_600_000;
    } else if (unit.startsWith("d")) {
      startAt = now - n * DAY_MS;
    } else if (unit.startsWith("w")) {
      startAt = now - n * 7 * DAY_MS;
    } else if (unit === "mo" || unit === "mon" || unit.startsWith("month")) {
      startAt = addUTCMonths(now, -n);
    } else {
      startAt = addUTCMonths(now, -n * 12);
    }
    return { startAt, endAt: now };
  }

  switch (preset) {
    case "today":
      return { startAt: startOfUTCDay(now), endAt: now };
    case "yesterday": {
      const start = startOfUTCDay(now) - DAY_MS;
      return { startAt: start, endAt: startOfUTCDay(now) };
    }
    case "week":
    case "this-week":
      return { startAt: startOfUTCWeek(now), endAt: now };
    case "last-week": {
      const thisWeek = startOfUTCWeek(now);
      return { startAt: thisWeek - 7 * DAY_MS, endAt: thisWeek };
    }
    case "month":
    case "this-month":
      return { startAt: startOfUTCMonth(now), endAt: now };
    case "last-month": {
      const thisMonth = startOfUTCMonth(now);
      return { startAt: addUTCMonths(thisMonth, -1), endAt: thisMonth };
    }
    case "year":
    case "this-year":
      return { startAt: startOfUTCYear(now), endAt: now };
    case "last-year": {
      const thisYear = startOfUTCYear(now);
      return { startAt: Date.UTC(new Date(thisYear).getUTCFullYear() - 1, 0, 1), endAt: thisYear };
    }
    default:
      throw new UmamiInputError(
        `Unrecognized range "${raw}". Use e.g. "24h", "7d", "30d", "12w", "today", "yesterday", "this-week", "last-month", "this-year", or explicit startAt/endAt.`,
      );
  }
}

/**
 * Resolve a {@link DateRangeInput} to absolute epoch-ms bounds. Explicit
 * `startAt`/`endAt` win over `range`. Defaults to the last 7 days.
 */
export function resolveDateRange(input: DateRangeInput | undefined, now: number = Date.now()): ResolvedRange {
  const i = input ?? {};
  if (i.startAt !== undefined || i.endAt !== undefined) {
    const endAt = i.endAt !== undefined ? parseInstant(i.endAt) : now;
    const startAt = i.startAt !== undefined ? parseInstant(i.startAt) : endAt - 7 * DAY_MS;
    if (startAt > endAt) throw new UmamiInputError("startAt must be <= endAt");
    return { startAt, endAt };
  }
  return resolvePreset(i.range ?? "7d", now);
}
