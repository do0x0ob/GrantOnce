import { CLAIM_DEFS, isClaimId } from "./claims";
import { PURPOSES } from "./purposes";
import { RISK_LABEL } from "./risk";
import type { DemoState, GrantStatus } from "./types";
import { isCredentialValid, verifyCredential } from "./wallet";

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  proposed: "待簽署",
  signed: "已簽署 · 待兌現",
  redeemed: "已兌現 · 耗用",
  revoked: "已撤銷",
  expired: "已逾效期",
};

/**
 * Formats in Asia/Taipei without Intl.
 *
 * `toLocaleString` produced different invisible separators under Node's ICU and
 * the browser's, which React saw as a hydration mismatch on every timestamp.
 * Taipei has no DST, so a fixed offset and UTC getters are exact and identical
 * on both sides.
 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipei(iso: string): Date {
  return new Date(new Date(iso).getTime() + TAIPEI_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatClock(iso: string): string {
  const d = taipei(iso);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function formatDate(iso: string): string {
  const d = taipei(iso);
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}

export function formatTime(iso: string): string {
  const d = taipei(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function formatStamp(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function claimLabel(id: string): string {
  return isClaimId(id) ? CLAIM_DEFS[id].label : id;
}

/**
 * What leaves the server.
 *
 * The vault is described but never valued: the console shows that 所得 and 健保
 * are held and never entered a grant, without shipping the numbers to the
 * browser.
 */
export function principalView(state: DemoState) {
  const now = new Date();
  return {
    principal: {
      id: state.principal.id,
      name: state.principal.name,
      summary: state.principal.summary,
      synthetic: state.principal.synthetic,
      key: {
        registered: Boolean(state.principal.key.publicKey),
        method: state.principal.key.method,
        registeredAt: state.principal.key.registeredAt,
        publicKey: state.principal.key.publicKey,
        fingerprint: state.principal.key.publicKey?.slice(0, 12) ?? null,
      },
    },
    // Catalogue only: labels and notes, never values.
    vaultCatalog: state.vaultCatalog.map((entry) => ({
      fieldId: entry.fieldId,
      label: entry.label,
      group: entry.group,
      sealed: entry.sealed,
      note: entry.note,
      /** True when no credential in the wallet was ever derived from this field. */
      neverLeft: !state.wallet.some((c) =>
        CLAIM_DEFS[c.claimId].derivedFrom.includes(entry.fieldId),
      ),
    })),
    wallet: state.wallet.map((c) => ({
      id: c.id,
      claimId: c.claimId,
      label: c.label,
      value: c.value,
      sensitivity: c.sensitivity,
      issuerName: c.issuerName,
      audience: c.audience,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      valid: isCredentialValid(c, now),
      signatureValid: verifyCredential(c),
      presentedCount: c.presentedCount,
      derivedFrom: CLAIM_DEFS[c.claimId].derivedFrom,
    })),
    grants: state.grants.map((g) => {
      const expired = new Date(g.body.exp).getTime() < now.getTime();
      // A capsule that has run out reads as expired even before anything tries
      // to redeem it and flips the stored status.
      const effectiveStatus =
        expired && (g.status === "proposed" || g.status === "signed") ? "expired" : g.status;
      return {
      id: g.id,
      status: effectiveStatus,
      statusLabel: GRANT_STATUS_LABEL[effectiveStatus],
      purpose: g.body.purpose,
      programTitle: PURPOSES[g.body.purpose].title,
      agencyId: g.body.aud,
      agencyName: PURPOSES[g.body.purpose].agencyName,
      privacyBasis: PURPOSES[g.body.purpose].privacyBasis,
      programBasis: PURPOSES[g.body.purpose].programBasis ?? [],
      claims: g.body.claims.map((c) => ({
        claimId: c,
        label: claimLabel(c),
        shape: isClaimId(c) ? CLAIM_DEFS[c].shape : "",
        sensitivity: isClaimId(c) ? CLAIM_DEFS[c].sensitivity : "personal",
      })),
      displayText: g.body.displayText,
      jti: g.body.jti,
      exp: g.body.exp,
      cnfJkt: g.body.cnf.jkt,
      digest: g.digest,
      serialized: g.serialized,
      signature: g.signature,
      signMethod: g.signMethod,
      risk: g.risk,
      riskLabel: RISK_LABEL[g.risk],
      riskNotes: g.riskNotes,
      proposedAt: g.proposedAt,
      signedAt: g.signedAt,
      redeemedAt: g.redeemedAt,
      revokedAt: g.revokedAt,
      expired,
      };
    }),
    inboxes: state.inboxes,
    delegation: state.delegation,
    notifications: [...state.notifications].reverse(),
    audit: state.audit,
    chat: state.chat,
    plan: state.plan,
    clockOffsetDays: state.clockOffsetDays ?? 0,
    usedJtiCount: state.usedJti.length,
  };
}

export type PrincipalView = ReturnType<typeof principalView>;
