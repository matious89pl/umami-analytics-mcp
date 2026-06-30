import type { Deployment } from "./umami/types";

/** Tiers requested by the operator via env flags. */
export interface RequestedScopes {
  write: boolean;
  admin: boolean;
  destructive: boolean;
}

/**
 * Effective capability tiers after applying real-world constraints. `read` is
 * always on. Tools consult this to decide whether to register and to guard
 * individual calls.
 */
export interface ResolvedScopes {
  readonly read: true;
  readonly write: boolean;
  /** Effective admin = requested AND self-hosted (Cloud has no user admin API). */
  readonly admin: boolean;
  /** Effective destructive = requested AND (write OR admin). */
  readonly destructive: boolean;
  /** Human-readable explanations of any downgrades, surfaced at startup. */
  readonly notes: readonly string[];
}

/**
 * Resolve requested tiers against the deployment. Downgrades are explained in
 * `notes` so the operator understands why a tool may be absent.
 */
export function resolveScopes(requested: RequestedScopes, deployment: Deployment): ResolvedScopes {
  const notes: string[] = [];

  const write = requested.write;

  let admin = requested.admin;
  if (admin && deployment === "cloud") {
    admin = false;
    notes.push(
      "admin tier requested but disabled: Umami Cloud does not expose user-administration endpoints (self-hosted only).",
    );
  }

  let destructive = requested.destructive;
  if (destructive && !write && !admin) {
    destructive = false;
    notes.push(
      "destructive tier requested but inert: it only takes effect alongside the write or admin tier.",
    );
  }

  return { read: true, write, admin, destructive, notes };
}

/** One-line summary of the enabled tiers, for the startup stderr banner. */
export function describeScopes(scopes: ResolvedScopes): string {
  const tiers = ["read"];
  if (scopes.write) tiers.push("write");
  if (scopes.admin) tiers.push("admin");
  if (scopes.destructive) tiers.push("destructive");
  return `tiers enabled: ${tiers.join(", ")}`;
}
