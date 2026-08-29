import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AgencyId,
  AuditEntry,
  Envelope,
  EnvelopeReceipt,
  FieldId,
  Grant,
  GrantId,
  TicketClaims,
} from "./types";

/** Canonical audience ids for the demo agencies. Not minted by callers. */
export const AGENCY_AUDIENCE: Record<AgencyId, string> = {
  jia: "agency-jia",
  yi: "agency-yi",
};

export const GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export function audienceOfAgency(agencyId: AgencyId): string {
  return AGENCY_AUDIENCE[agencyId];
}

export function actorLabel(id: string): string {
  if (id === "agency-jia") return "甲｜新北市社會局";
  if (id === "agency-yi") return "乙｜經濟部能源署 × 台電";
  if (id === "agent") return "補助代理人";
  if (id === "P-lin-demo") return "林曉晴";
  return id;
}

export function actorRole(id: string): AuditEntry["actorRole"] {
  if (id === "agency-jia") return "agency-jia";
  if (id === "agency-yi") return "agency-yi";
  if (id === "agent") return "agent";
  if (id === "P-lin-demo") return "principal";
  return "system";
}

export function expiresAtFrom(iso: string, ttlMs = GRANT_TTL_MS): string {
  return new Date(Date.parse(iso) + ttlMs).toISOString();
}

export function isGrantExpired(grant: Pick<Grant, "expiresAt">, now = Date.now()): boolean {
  return Date.parse(grant.expiresAt) <= now;
}

/**
 * HMAC key stays in the runtime. Never a tool argument, never drawn on grant cards.
 * Override with GRANTONCE_HMAC_KEY in a real deployment.
 */
function hmacKey(): Buffer {
  return Buffer.from(process.env.GRANTONCE_HMAC_KEY ?? "grantonce-demo-hmac-key", "utf8");
}

export function newTicketJti(): string {
  return `grn_${randomBytes(16).toString("hex")}`;
}

export function canonicalTicket(claims: TicketClaims): string {
  return JSON.stringify({
    jti: claims.jti,
    grantId: claims.grantId,
    iss: claims.iss,
    aud: claims.aud,
    fields: [...claims.fields].sort(),
    exp: claims.exp,
  });
}

export function signTicket(claims: TicketClaims): string {
  const mac = createHmac("sha256", hmacKey()).update(canonicalTicket(claims), "utf8").digest("hex");
  return `${claims.jti}.${mac}`;
}

function tokenCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  try {
    candidates.push(Buffer.from(trimmed, "latin1").toString("utf8"));
  } catch {
    // ignore
  }
  try {
    candidates.push(decodeURIComponent(trimmed));
  } catch {
    // ignore
  }
  return candidates;
}

/** Full HMAC ticket: `grn_<hex>.<64-hex mac>`. */
export function parseTicketToken(raw: string): { jti: string; mac: string } | null {
  for (const value of tokenCandidates(raw)) {
    const match = /^(grn_[0-9a-f]+)\.([0-9a-f]{64})$/i.exec(value);
    if (match) {
      return { jti: match[1], mac: match[2].toLowerCase() };
    }
  }
  return null;
}

/**
 * Ticket id (`grn_…`) or full HMAC token. Slot ids like G-jia are rejected.
 */
export function parseTicketRef(raw: string): { jti: string; mac: string | null } | null {
  const parsed = parseTicketToken(raw);
  if (parsed) return parsed;
  for (const value of tokenCandidates(raw)) {
    const match = /^(grn_[0-9a-f]+)$/i.exec(value);
    if (match) return { jti: match[1], mac: null };
  }
  return null;
}

export function verifyTicketMac(claims: TicketClaims, mac: string): boolean {
  const expected = createHmac("sha256", hmacKey())
    .update(canonicalTicket(claims), "utf8")
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(mac, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function hashFieldPayload(fields: Partial<Record<FieldId, string>>): string {
  const keys = (Object.keys(fields) as FieldId[]).sort();
  const canonical = keys.map((key) => `${key}=${fields[key] ?? ""}`).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function buildReceipt(
  jti: string,
  fields: Partial<Record<FieldId, string>>,
  submittedAt: string,
): EnvelopeReceipt {
  return {
    grantJti: jti,
    fieldIds: (Object.keys(fields) as FieldId[]).sort(),
    hash: hashFieldPayload(fields),
    submittedAt,
  };
}

export function emptyEnvelope(grantId: GrantId, agencyId: AgencyId): Envelope {
  return {
    grantId,
    agencyId,
    fields: {},
    fetchedAt: null,
    receipt: null,
  };
}
