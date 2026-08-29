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

export type GrantId = "G-甲" | "G-乙";
export type AgencyId = "jia" | "yi";
/** pending = proposed but not yet approved. Harness UI still says 待核准. */
export type GrantStatus = "pending" | "active" | "consumed" | "revoked";
export type GrantSource = "mydata" | "wallet" | "user";
export type RevokeOn = "submitted" | "user" | "expired";
export type AuditAction = "approve" | "fetch" | "submit" | "revoke" | "deny" | "receipt";

export type TicketClaims = {
  jti: string;
  grantId: GrantId;
  iss: string;
  aud: string;
  fields: FieldId[];
  exp: string;
};

export type StoredTicket = TicketClaims & {
  token: string;
};

/**
 * GrantOnce authorization instrument. Harness-agnostic protocol object.
 * issuer = who authorized (person / court / institution id — never implied).
 * audience = who may fetch/submit. Bound into the HMAC ticket at approve time.
 */
export type Grant = {
  id: GrantId;
  issuer: string;
  subject: string;
  audience: string;
  purpose: string;
  fields: FieldId[];
  source: GrantSource;
  expiresAt: string;
  status: GrantStatus;
  revokeOn: RevokeOn;
  /** Demo harness: which agency card this grant feeds. Not the protocol audience. */
  agencyId: AgencyId;
  programTitle: string;
  proposedAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  consumedAt: string | null;
  /** Opaque ticket id `grn_…`. Null until approve. */
  ticketId: string | null;
  /**
   * Full HMAC ticket for the agency desk harness. Not the HMAC key.
   * Grant cards must not draw this.
   */
  ticket: string | null;
};

export type EnvelopeReceipt = {
  grantJti: string;
  fieldIds: FieldId[];
  hash: string;
  submittedAt: string;
};

export type Envelope = {
  grantId: GrantId;
  agencyId: AgencyId;
  fields: Partial<Record<FieldId, string>>;
  fetchedAt: string | null;
  receipt: EnvelopeReceipt | null;
};

export type ProtocolEvent = {
  at: string;
  request: {
    authorization: string;
    fields: string[];
    path: "/api/mydata/fetch" | "/api/applications/submit";
  };
  response: {
    ok: boolean;
    status: number;
    code?: string;
    error?: string;
    fieldIds?: FieldId[];
  };
};

export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  actorRole: "principal" | "agent" | "agency-jia" | "agency-yi" | "system";
  action: AuditAction;
  grantId: GrantId | null;
  detail: string;
  deniedFields?: FieldId[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: string;
};

export type ProgramPlan = {
  grantId: GrantId;
  title: string;
  agencyId: AgencyId;
  agencyName: string;
  reasons: string[];
  requiredFields: FieldId[];
  hint?: string;
};

export type AgentPlan = {
  utterance: string;
  matchedAt: string;
  programs: ProgramPlan[];
  ageHint: string;
  notes: string[];
};

export type AgencyView = {
  id: AgencyId;
  name: string;
  programTitle: string;
  lastDenial: string | null;
  lastDeniedAt: string | null;
  submittedAt: string | null;
};

export type VaultCatalogEntry = {
  fieldId: FieldId;
  label: string;
  group: string;
  inVault: true;
  sealed: boolean;
  note: string;
};

export type VaultHolding = {
  fieldId: FieldId;
  label: string;
  group: string;
  value: string;
  sealed: boolean;
};

export type DemoState = {
  principal: {
    id: string;
    name: string;
    summary: string;
    synthetic: true;
  };
  vaultCatalog: VaultCatalogEntry[];
  vaultHoldings: VaultHolding[];
  grants: Grant[];
  envelopes: Record<GrantId, Envelope>;
  tickets: Record<string, StoredTicket>;
  audit: AuditEntry[];
  chat: ChatMessage[];
  plan: AgentPlan | null;
  agencies: Record<AgencyId, AgencyView>;
  lastProtocol: ProtocolEvent | null;
};

export type AuthzDenialCode =
  | "OVERSCOPED"
  | "GRANT_INACTIVE"
  | "UNKNOWN_GRANT"
  | "BAD_BEARER"
  | "BAD_TICKET"
  | "WILDCARD_FORBIDDEN"
  | "AUDIENCE_MISMATCH"
  | "ISSUER_MISMATCH"
  | "NO_ENVELOPE";

export type FetchResult =
  | {
      ok: true;
      grantId: GrantId;
      fieldIds: FieldId[];
    }
  | {
      ok: false;
      status: 403;
      code: AuthzDenialCode;
      error: string;
      deniedFields?: FieldId[];
    };

export type SubmitResult =
  | { ok: true; grantId: GrantId }
  | { ok: false; status: 403; code: AuthzDenialCode; error: string };

/** Library-only caller for revoke issuer checks. MCP does not take this. */
export type GrantCaller = {
  id: string;
  name?: string;
};
