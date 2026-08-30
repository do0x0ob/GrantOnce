import { CLAIM_DEFS, isClaimId, type ClaimId } from "./claims";
import { randomId, serializeBody, sign, verify } from "./crypto";
import { ISSUER_KEYS, issuerName } from "./parties";
import type { AgencyId, Credential, DemoState } from "./types";

function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

/** Pairwise claims are minted per agency; everything else is agency-agnostic. */
export function audienceFor(claimId: ClaimId, agency: AgencyId): AgencyId | null {
  return CLAIM_DEFS[claimId].sensitivity === "pseudonym" ? agency : null;
}

export function credentialMatches(
  cred: Credential,
  claimId: ClaimId,
  agency: AgencyId,
): boolean {
  if (cred.claimId !== claimId) return false;
  const want = audienceFor(claimId, agency);
  return cred.audience === want;
}

export function isCredentialValid(cred: Credential, now: Date): boolean {
  if (cred.revoked) return false;
  return new Date(cred.expiresAt).getTime() > now.getTime();
}

export function findValidCredential(
  state: DemoState,
  claimId: ClaimId,
  agency: AgencyId,
  now: Date,
): Credential | null {
  return (
    state.wallet.find(
      (c) => credentialMatches(c, claimId, agency) && isCredentialValid(c, now),
    ) ?? null
  );
}

/**
 * Reads the vault, derives the claim, and signs it with the holding authority's
 * key. This is the only path by which anything derived from a raw record
 * reaches an agency.
 */
export function issueCredential(
  state: DemoState,
  claimId: ClaimId,
  agency: AgencyId,
  now: Date,
): Credential {
  const def = CLAIM_DEFS[claimId];
  const audience = audienceFor(claimId, agency);
  const value = def.compute({
    subject: state.principal.id,
    audience: agency,
    today: now.toISOString().slice(0, 10),
  });

  const body = {
    aud: audience,
    claim: claimId,
    exp: addDays(now, def.ttlDays),
    iat: now.toISOString(),
    iss: def.issuer,
    sub: state.principal.id,
    val: value,
  };
  const serialized = serializeBody(body);

  const cred: Credential = {
    id: randomId("vc"),
    claimId,
    label: def.label,
    value,
    sensitivity: def.sensitivity,
    issuer: def.issuer,
    issuerName: issuerName(def.issuer),
    subject: state.principal.id,
    audience,
    issuedAt: body.iat,
    expiresAt: body.exp,
    serialized,
    signature: sign(serialized, ISSUER_KEYS[def.issuer].secret),
    revoked: false,
    presentedCount: 0,
  };

  // A replacement, not an addition. Re-issuing after expiry used to leave the
  // dead copy in the wallet, so the wallet grew every time a 30-day predicate
  // aged out — and the screen showed the holder several credentials for the one
  // fact, most of them useless.
  state.wallet = state.wallet.filter(
    (existing) => !(existing.claimId === claimId && existing.audience === audience),
  );
  state.wallet.push(cred);
  return cred;
}

/**
 * An agency verifies the issuer's signature; it never has to trust the agent.
 *
 * The signature covers `serialized`, so the fields presented alongside it are
 * only trustworthy once they are checked against what was signed. Verifying the
 * signature but then delivering `cred.value` would let anyone who can edit the
 * wallet swap in any value they like under a valid signature.
 */
export function verifyCredential(cred: Credential): boolean {
  const key = ISSUER_KEYS[cred.issuer];
  if (!key) return false;
  if (!verify(cred.signature, cred.serialized, key.publicKey)) return false;

  let signed: {
    aud?: AgencyId | null;
    claim?: string;
    exp?: string;
    iss?: string;
    sub?: string;
    val?: string;
  };
  try {
    signed = JSON.parse(cred.serialized);
  } catch {
    return false;
  }
  return (
    signed.val === cred.value &&
    signed.claim === cred.claimId &&
    signed.iss === cred.issuer &&
    signed.sub === cred.subject &&
    signed.exp === cred.expiresAt &&
    (signed.aud ?? null) === cred.audience
  );
}

export type EnsureResult = {
  issued: ClaimId[];
  reused: ClaimId[];
  credentials: Credential[];
};

/** Reuses anything already held and still valid; issues only what is missing. */
export function ensureCredentials(
  state: DemoState,
  claims: ClaimId[],
  agency: AgencyId,
  now: Date,
): EnsureResult {
  const issued: ClaimId[] = [];
  const reused: ClaimId[] = [];
  const credentials: Credential[] = [];

  for (const claimId of claims) {
    if (!isClaimId(claimId)) continue;
    const existing = findValidCredential(state, claimId, agency, now);
    if (existing) {
      reused.push(claimId);
      credentials.push(existing);
      continue;
    }
    credentials.push(issueCredential(state, claimId, agency, now));
    issued.push(claimId);
  }

  return { issued, reused, credentials };
}
