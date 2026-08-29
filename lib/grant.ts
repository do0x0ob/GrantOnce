import type { AgencyId, AuditEntry, Grant } from "./types";

/** Canonical audience ids for the demo agencies. Actors cannot mint these. */
export const AGENCY_AUDIENCE: Record<AgencyId, string> = {
  jia: "agency-jia",
  yi: "agency-yi",
};

export const GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export function audienceOfAgency(agencyId: AgencyId): string {
  return AGENCY_AUDIENCE[agencyId];
}

/**
 * Normalize a caller id. Demo aliases (甲 / jia / agency-jia) collapse to
 * agency-jia. Unknown strings pass through as opaque principal ids.
 * Empty / missing → null (caller must be explicit).
 */
export function parseActorId(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "甲") return "agency-jia";
  if (trimmed === "乙") return "agency-yi";
  const key = trimmed.toLowerCase();
  if (key === "agency-jia" || key === "jia" || key === "agency-a") return "agency-jia";
  if (key === "agency-yi" || key === "yi" || key === "agency-b") return "agency-yi";
  if (key === "agent") return "agent";
  return trimmed;
}

export function actorLabel(id: string): string {
  if (id === "agency-jia") return "甲｜新北市社會局";
  if (id === "agency-yi") return "乙｜經濟部能源署 × 台電";
  if (id === "agent") return "補助代理人";
  return id;
}

export function actorRole(id: string): AuditEntry["actorRole"] {
  if (id === "agency-jia") return "agency-jia";
  if (id === "agency-yi") return "agency-yi";
  if (id === "agent") return "agent";
  return "system";
}

export function expiresAtFrom(iso: string, ttlMs = GRANT_TTL_MS): string {
  return new Date(Date.parse(iso) + ttlMs).toISOString();
}

export function isGrantExpired(grant: Pick<Grant, "expiresAt">, now = Date.now()): boolean {
  return Date.parse(grant.expiresAt) <= now;
}
