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
export type AuditAction = "approve" | "fetch" | "submit" | "revoke" | "deny";

/**
 * GrantOnce authorization instrument. Harness-agnostic protocol object.
 * issuer = who authorized (person / court / institution id — never implied).
 * audience = who may fetch/submit. Callers cannot self-claim this field.
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
};

export type Envelope = {
  grantId: GrantId;
  agencyId: AgencyId;
  fields: Partial<Record<FieldId, string>>;
  fetchedAt: string | null;
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
  audit: AuditEntry[];
  chat: ChatMessage[];
  plan: AgentPlan | null;
  agencies: Record<AgencyId, AgencyView>;
};

export type AuthzDenialCode =
  | "OVERSCOPED"
  | "GRANT_INACTIVE"
  | "UNKNOWN_GRANT"
  | "BAD_BEARER"
  | "WILDCARD_FORBIDDEN"
  | "AUDIENCE_MISMATCH"
  | "MISSING_ACTOR"
  | "NO_ENVELOPE";

export type FetchResult =
  | {
      ok: true;
      grantId: GrantId;
      fields: Partial<Record<FieldId, string>>;
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

/** Caller of fetch_field / submit_application. `id` must equal grant.audience. */
export type GrantCaller = {
  id: string;
  name?: string;
};
