import type { ClaimId, IssuerId, Sensitivity } from "./claims";
import type { PurposeDef, PurposeId } from "./purposes";
import type { ToolName } from "./tools";

/** Raw MyData vault fields. Only ever read when issuing a credential. */
export const FIELD_IDS = [
  "household.city",
  "household.address",
  "household.previousCity",
  "household.moveDate",
  "household.householdId",
  "parentChild.childName",
  "parentChild.childBirthDate",
  "parentChild.relation",
  "income.annualIncome",
  "income.taxYear",
  "nhi.cardId",
  "nhi.status",
  "taipower.meterId",
  "taipower.usage.m1",
  "taipower.usage.m2",
  "taipower.usage.m3",
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

export type GrantId = "G-甲" | "G-乙" | "G-丙";
export type AgencyId = "jia" | "yi";

export type GrantStatus = "proposed" | "signed" | "redeemed" | "revoked" | "expired";

export type AuditAction =
  | "register"
  | "issue"
  | "sign"
  | "redeem"
  | "submit"
  | "revoke"
  | "deny"
  | "notify"
  | "acknowledge";

export type RiskLevel = "low" | "elevated" | "blocked";

/** Issued once by the authority holding the record, presented while still
 *  valid — so a slow lookup is paid for once, not once per application. */
export type Credential = {
  id: string;
  claimId: ClaimId;
  label: string;
  value: string;
  sensitivity: Sensitivity;
  issuer: IssuerId;
  issuerName: string;
  subject: string;
  /** Pairwise claims are bound to one agency and are useless to any other. */
  audience: AgencyId | null;
  issuedAt: string;
  expiresAt: string;
  serialized: string;
  signature: string;
  revoked: boolean;
  presentedCount: number;
};

/** Exactly the bytes the principal signs. */
export type GrantBody = {
  aud: AgencyId;
  claims: ClaimId[];
  cnf: { jkt: string };
  displayText: string;
  exp: string;
  iat: string;
  iss: string;
  jti: string;
  purpose: PurposeId;
};

export type Grant = {
  id: GrantId;
  body: GrantBody;
  /** Serialised once at proposal time and carried verbatim; never re-serialised. */
  serialized: string;
  digest: string;
  signature: string | null;
  signedByKey: string | null;
  signMethod: "passkey" | "software" | null;
  status: GrantStatus;
  risk: RiskLevel;
  riskNotes: string[];
  proposedAt: string;
  signedAt: string | null;
  redeemedAt: string | null;
  revokedAt: string | null;
};

export type DeliveredClaim = {
  claimId: ClaimId;
  label: string;
  value: string;
  sensitivity: Sensitivity;
  issuer: IssuerId;
  issuerName: string;
  issuerSignatureValid: boolean;
};

/**
 * Demo fixture. Nothing past "submitted" is driven by a real agency — the demo
 * advances it by hand through `POST /api/agency/advance`. It exists so progress
 * tracking has a place in the protocol, not to pretend the connection is real.
 */
export type ApplicationStatus =
  | "none"
  | "received"
  | "submitted"
  | "under-review"
  | "needs-more"
  | "approved"
  | "paid";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "none",
  "received",
  "submitted",
  "under-review",
  "needs-more",
  "approved",
  "paid",
];

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as string[]).includes(value);
}

export type AgencyInbox = {
  agencyId: AgencyId;
  name: string;
  programTitle: string;
  purpose: PurposeId;
  claims: DeliveredClaim[];
  grantDigest: string | null;
  receivedAt: string | null;
  submittedAt: string | null;
  lastDenial: string | null;
  lastDeniedAt: string | null;
  /** Demo-only. See ApplicationStatus. */
  applicationStatus: ApplicationStatus;
  statusChangedAt: string | null;
};

export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  actorRole: "principal" | "agent" | "agency-jia" | "agency-yi" | "issuer" | "system";
  action: AuditAction;
  grantId: GrantId | null;
  detail: string;
  deniedClaims?: string[];
  risk?: RiskLevel;
};

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: string;
};

export type ProgramPlan = {
  grantId: GrantId;
  purpose: PurposeId;
  title: string;
  agencyId: AgencyId;
  agencyName: string;
  reasons: string[];
  claims: ClaimId[];
  hint?: string;
};

/** Only the utterance is read back, to re-match when the demo clock moves. */
export type AgentPlan = {
  utterance: string;
  matchedAt: string;
};

/**
 * The delegation the principal configures once: which agencies, which purposes,
 * how sensitive, until when. Revoking this is instant and stops the agent from
 * signing anything new — the one revocation that always works.
 */
export type Delegation = {
  active: boolean;
  agencies: AgencyId[];
  purposes: PurposeId[];
  maxSensitivity: Sensitivity;
  grantTtlSeconds: number;
  validUntil: string;
  revokedAt: string | null;
  revokedReason: string | null;
};

export type NotificationKind =
  | "eligibility-gained"
  | "eligibility-change"
  | "credential-expiry"
  | "credential-expiring"
  | "grant-expiring"
  | "delegation-expiring"
  | "denial-followup"
  | "awaiting-signature"
  | "risk"
  | "info";

export type NotificationSeverity = "info" | "action-required" | "risk";

/** Advisory only. There is no signing tool, so this can never mint authority. */
export type SuggestedAction = {
  tool: ToolName;
  args: Record<string, string>;
  label: string;
};

export type Notification = {
  id: string;
  /** Stable dedupe key. Two scans of the same condition produce the same key. */
  key: string;
  at: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  /** Human-facing. MAY contain predicate values. Never sent to the model. */
  body: string;
  /** Model-facing. MUST NOT contain any vault value or predicate value. */
  summaryForAgent: string;
  grantId: GrantId | null;
  suggestedAction: SuggestedAction | null;
  /** When this notice stops being true; null means it does not self-expire. */
  staleAfter: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
};

/** What a detector produces: the store fills in id, timestamp and ack state. */
export type NotificationDraft = Omit<
  Notification,
  "id" | "at" | "acknowledged" | "acknowledgedAt"
>;

export type VaultCatalogEntry = {
  fieldId: FieldId;
  label: string;
  group: string;
  sealed: boolean;
  note: string;
};

export type PrincipalKey = {
  publicKey: string | null;
  method: "passkey" | "software" | null;
  registeredAt: string | null;
  credentialId: string | null;
};

export type DemoState = {
  /** Bumped whenever the persisted shape changes; older files are discarded. */
  version: number;
  principal: {
    id: string;
    name: string;
    summary: string;
    synthetic: true;
    key: PrincipalKey;
  };
  vaultCatalog: VaultCatalogEntry[];
  wallet: Credential[];
  grants: Grant[];
  inboxes: Record<AgencyId, AgencyInbox>;
  usedJti: string[];
  delegation: Delegation;
  notifications: Notification[];
  audit: AuditEntry[];
  chat: ChatMessage[];
  plan: AgentPlan | null;
  /** Demo-only clock shift, so the 0–2 age band can be aged out on stage. */
  clockOffsetDays: number;
  /** Agency-maintained purpose rows. Overlay on the builtin table. */
  registeredPurposes: Record<string, PurposeDef>;
  retiredPurposes: string[];
  /** Last time the agent's watch loop ran. Drives "since" and the UI's 巡檢時間. */
  lastTickAt: string | null;
};

export type RedeemProof = {
  agency: AgencyId;
  /** Binds the proof to this exact capsule, not just to a reused grant id. */
  digest: string;
  grantId: GrantId;
  nonce: string;
  iat: string;
  signature: string;
};

export type DenyCode =
  | "NO_DELEGATION"
  | "UNKNOWN_GRANT"
  | "UNSIGNED"
  | "BAD_SIGNATURE"
  | "EXPIRED"
  | "REPLAYED"
  | "WRONG_AUDIENCE"
  | "KEY_NOT_BOUND"
  | "BAD_AGENCY_PROOF"
  | "OUTSIDE_PURPOSE"
  | "RISK_BLOCKED"
  | "MISSING_CREDENTIAL"
  | "REVOKED";

export type RedeemResult =
  | {
      ok: true;
      grantId: GrantId;
      claimIds: ClaimId[];
      deliveredTo: AgencyId;
    }
  | {
      ok: false;
      status: 403;
      code: DenyCode;
      error: string;
      deniedClaims?: string[];
      failedKey?: "principal" | "agency";
    };
