/** Shared Umami domain types. Response shapes are kept intentionally loose
 * (index signatures) because they vary across Umami versions; each tool's Zod
 * outputSchema is the real contract presented to the model. */

export type Deployment = "cloud" | "self-hosted";

export type AuthConfig =
  | { readonly kind: "apiKey"; readonly apiKey: string }
  | { readonly kind: "login"; readonly username: string; readonly password: string };

export interface Website {
  id: string;
  name: string;
  domain?: string | null;
  shareId?: string | null;
  teamId?: string | null;
  userId?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  resetAt?: string | null;
  [key: string]: unknown;
}

export interface UmamiUser {
  id: string;
  username: string;
  role?: string;
  createdAt?: string;
  isAdmin?: boolean;
  [key: string]: unknown;
}

export interface Team {
  id: string;
  name: string;
  accessCode?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

/** Result of `GET /api/me` / `POST /api/auth/verify`. */
export interface MeResponse {
  id?: string;
  username?: string;
  role?: string;
  isAdmin?: boolean;
  user?: UmamiUser;
  teams?: Team[];
  [key: string]: unknown;
}

/** A single breakdown row from `/metrics` (e.g. `{ x: "/pricing", y: 1234 }`). */
export interface MetricRow {
  x: string | null;
  y: number;
  [key: string]: unknown;
}

/** Paginated list envelope used by websites/users/teams/sessions/etc. */
export interface PagedResult<T> {
  data: T[];
  count?: number;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}
