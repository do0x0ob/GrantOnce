import { CLAIM_DEFS, ISSUERS, isClaimId } from "./claims";
import { PURPOSES } from "./purposes";
import { purposesFrom, registryView } from "./registry";
import { RISK_LABEL } from "./risk";
import type { DemoState, GrantStatus, ServiceRequestStatus } from "./types";
import { isCredentialValid, verifyCredential } from "./wallet";

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  proposed: "待簽署",
  signed: "已簽署 · 待兌現",
  redeemed: "已兌現 · 耗用",
  revoked: "已撤銷",
  expired: "已逾效期",
};

export const SERVICE_REQUEST_LABEL: Record<ServiceRequestStatus, string> = {
  "awaiting-confirmation": "等你確認",
  "awaiting-signature": "已通過檢查 · 待你簽署",
  authorized: "已簽署 · 待機關兌現",
  "data-delivered": "資料已交付辦理機關",
  processing: "機關辦理中",
  completed: "已辦結",
  blocked: "檢查未通過",
  cancelled: "已作廢",
};

/**
 * Every timestamp on screen is assembled from parts, never from a locale's own
 * joined output.
 *
 * `toLocaleString` renders the same instant differently on either side of
 * hydration: Node's ICU puts U+2009 THIN SPACE between date and time where
 * Chromium puts U+0020, and React compares the two strings byte for byte. The
 * result was a hydration error and a re-rendered tree on every page load, plus
 * a red issue badge in `next dev`. Reading `formatToParts` and joining the
 * fields ourselves keeps the separators out of the locale's hands.
 *
 * The time zone is always pinned too. Without it the server formats in the
 * container's zone and the browser in the viewer's, so the same capsule expiry
 * printed two different clock times either side of hydration.
 */
const TAIPEI = "Asia/Taipei";

function parts(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const found: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("zh-TW", {
    ...options,
    // h23 rather than `hour12: false`: with hour12 alone some ICU builds pick
    // the h24 cycle and render midnight as 24:00:00.
    hourCycle: "h23",
    timeZone: TAIPEI,
  }).formatToParts(new Date(iso))) {
    found[part.type] = part.value;
  }
  return found;
}

const HMS = { hour: "2-digit", minute: "2-digit", second: "2-digit" } as const;
const YMD = { year: "numeric", month: "2-digit", day: "2-digit" } as const;

/** `08/30 00:04:01` — audit rows. */
export function formatClock(iso: string): string {
  const p = parts(iso, { ...YMD, ...HMS });
  return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** `00:04:01` — capsule expiry, where the date is always today. */
export function formatTime(iso: string): string {
  const p = parts(iso, HMS);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** `2026/9/28` — credential and delegation expiry. */
export function formatDate(iso: string): string {
  const p = parts(iso, YMD);
  return `${p.year}/${Number(p.month)}/${Number(p.day)}`;
}

/** `2026/08/30 00:05:09` — the expiry written into the consent text the
 * principal signs, so it must be zero-padded and stable on both sides. */
export function formatStamp(iso: string): string {
  const p = parts(iso, { ...YMD, ...HMS });
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
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
    serviceRequests: state.serviceRequests.map((request) => ({
      ...request,
      claims: request.claims.map((claim) => ({
        claimId: claim,
        label: claimLabel(claim),
        shape: CLAIM_DEFS[claim].shape,
      })),
      dataSources: request.dataSources.map((source) => ({
        id: source,
        name: ISSUERS[source].name,
      })),
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
      programTitle: purposesFrom(state)[g.body.purpose]?.title ?? PURPOSES[g.body.purpose]?.title ?? g.body.purpose,
      agencyId: g.body.aud,
      agencyName:
        purposesFrom(state)[g.body.purpose]?.agencyName ??
        PURPOSES[g.body.purpose]?.agencyName ??
        g.body.aud,
      requestId: g.body.requestId,
      requester: g.body.requester,
      dataSources: g.body.dataSources.map((source) => ({
        id: source,
        name: ISSUERS[source].name,
      })),
      delivery: g.body.delivery,
      notice: g.body.notice,
      privacyBasis:
        purposesFrom(state)[g.body.purpose]?.privacyBasis ??
        PURPOSES[g.body.purpose]?.privacyBasis ??
        [],
      programBasis:
        purposesFrom(state)[g.body.purpose]?.programBasis ??
        PURPOSES[g.body.purpose]?.programBasis ??
        [],
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
    // The browser gets `body` — the principal is the one the values are about.
    // `summaryForAgent` is deliberately not here: it exists for the model, and
    // shipping both would invite the two to be used interchangeably.
    notifications: [...state.notifications].reverse().map((n) => ({
      id: n.id,
      key: n.key,
      at: n.at,
      kind: n.kind,
      severity: n.severity,
      title: n.title,
      body: n.body,
      grantId: n.grantId,
      suggestedAction: n.suggestedAction,
      acknowledged: n.acknowledged,
      acknowledgedAt: n.acknowledgedAt,
    })),
    audit: state.audit,
    chat: state.chat,
    plan: state.plan,
    clockOffsetDays: state.clockOffsetDays ?? 0,
    /** Shows that the agent is watching, rather than asking you to take it on trust. */
    lastTickAt: state.lastTickAt,
    usedJtiCount: state.usedJti.length,
    registry: registryView(state),
  };
}

export type PrincipalView = ReturnType<typeof principalView>;
