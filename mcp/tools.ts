import {
  makeAgencyProof,
  proposeGrantsFromPlan,
  redeemGrant,
  requestClaims,
  revokeDelegation,
  revokeGrant,
  submitApplication,
} from "../lib/authz";
import { pushChanges } from "../lib/agent";
import { catalogPublic, searchCatalog } from "../lib/catalog";
import { CLAIM_DEFS, isClaimId, SENSITIVITY_LABEL } from "../lib/claims";
import { normalizeGrantId } from "../lib/fields";
import { evaluateInquiry, formatInquiryMessage, inquiryPayload } from "../lib/inquiry";
import { isKnownAgency } from "../lib/parties";
import { isPurposeId, PURPOSES } from "../lib/purposes";
import { AGENT_NOTES, effectiveToday, HAPPY_PATH_UTTERANCE } from "../lib/rules";
import { appendChat, getState, mutate } from "../lib/store";
import type { AgencyId, GrantId } from "../lib/types";
import { VAULT } from "../lib/vault";

export const TOOL_NAMES = [
  "search_purposes",
  "plan_applications",
  "get_grant_for_signature",
  "redeem_grant",
  "request_claims",
  "submit_application",
  "revoke_grant",
  "stop_delegation",
  "get_audit",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Distinctive vault values the model must never receive. */
export const VAULT_VALUE_MARKERS = Object.values(VAULT.records).filter(
  (value) => value.length >= 4 && value !== "母親" && value !== "2025",
);

export function vaultLeakIn(payload: unknown): string | null {
  const blob = JSON.stringify(payload);
  for (const value of VAULT_VALUE_MARKERS) {
    if (blob.includes(value)) return value;
  }
  if (blob.includes("vaultHoldings") || blob.includes('"records"')) return "vault object";
  return null;
}

export function assertNoVaultLeak(payload: unknown, where: string) {
  const leak = vaultLeakIn(payload);
  if (leak) throw new Error(`${where} leaked vault to the model: ${leak}`);
}

function claimLabels(ids: readonly string[]): string[] {
  return ids.map((id) => (isClaimId(id) ? CLAIM_DEFS[id].label : id));
}

function requireGrantId(raw: string): GrantId {
  const grantId = normalizeGrantId(raw);
  if (!grantId) {
    throw new Error(`無效的匣編號：${raw}（可用 G-甲 / G-jia 或 G-乙 / G-yi）`);
  }
  return grantId;
}

function requireAgency(raw: string): AgencyId {
  const t = raw.trim().toLowerCase();
  const mapped =
    t === "yi" || t === "agency-yi" || t === "乙" || t === "agency-b"
      ? "yi"
      : t === "jia" || t === "agency-jia" || t === "甲" || t === "agency-a"
        ? "jia"
        : null;
  if (!mapped || !isKnownAgency(mapped)) throw new Error(`未登記的機關：${raw}`);
  return mapped;
}

function grantPublic(grantId: GrantId) {
  const grant = getState().grants.find((g) => g.id === grantId);
  if (!grant) return null;
  return {
    id: grant.id,
    status: grant.status,
    purpose: grant.body.purpose,
    programTitle: PURPOSES[grant.body.purpose].title,
    audience: grant.body.aud,
    boundToAgencyKey: grant.body.cnf.jkt,
    jti: grant.body.jti,
    expiresAt: grant.body.exp,
    claimIds: grant.body.claims,
    claimLabels: claimLabels(grant.body.claims),
    signed: Boolean(grant.signature),
    signMethod: grant.signMethod,
    risk: grant.risk,
    riskNotes: grant.riskNotes,
    digest: grant.digest,
  };
}

export function searchPurposes(query: string) {
  const hits = searchCatalog(query);
  const payload = {
    ok: true,
    query,
    matches: hits.map(catalogPublic),
    issuablePurposeIds: hits
      .filter((entry) => entry.issuable && entry.purposeId)
      .map((entry) => entry.purposeId),
    note: "這是本部署的目的目錄，不是即時網搜。issuable=false 不能 mint Grant，也不能發明述詞。",
    notes: [...AGENT_NOTES],
  };
  assertNoVaultLeak(payload, "search_purposes");
  return payload;
}

export function planApplications(utterance: string) {
  const message = utterance.trim() || HAPPY_PATH_UTTERANCE;
  const today = effectiveToday(getState());
  const inquiry = evaluateInquiry(message, today);

  mutate((s) => {
    appendChat(s, "user", message);
    appendChat(s, "agent", formatInquiryMessage(inquiry, today));
    if (!inquiry.canIssue) return;
    s.plan = { utterance: message, matchedAt: new Date().toISOString() };
    proposeGrantsFromPlan(s, inquiry.programs);
    pushChanges(s, new Date());
  });

  const payload = {
    ...inquiryPayload(inquiry, [
      "模型無法簽署。請委託人在皮夾用生物辨識簽署後才能兌現。",
      "search_purposes 只搜目錄；plan_applications 只有 canIssue 時才會提案。",
    ]),
    programs: inquiry.programs.map((p) => ({
      grantId: p.grantId,
      title: p.title,
      purpose: p.purpose,
      agency: p.agencyId,
      agencyName: p.agencyName,
      reasons: p.reasons,
      claimIds: p.claims,
      claimLabels: claimLabels(p.claims),
      sensitivities: p.claims.map((c) => SENSITIVITY_LABEL[CLAIM_DEFS[c].sensitivity]),
      legalBasis: PURPOSES[p.purpose].legalBasis,
      hint: p.hint,
    })),
  };
  assertNoVaultLeak(payload, "plan_applications");
  return payload;
}

/**
 * The model can propose, and can show the principal what they would be signing.
 * It cannot sign: the private key only exists behind the authenticator.
 */
export function getGrantForSignature(grantIdRaw: string) {
  const grantId = requireGrantId(grantIdRaw);
  const grant = getState().grants.find((g) => g.id === grantId);
  if (!grant) {
    const payload = { ok: false, error: `找不到匣 ${grantId}` };
    assertNoVaultLeak(payload, "get_grant_for_signature");
    return payload;
  }
  const payload = {
    ok: true,
    grant: grantPublic(grantId),
    consentText: grant.body.displayText,
    bytesToSign: grant.serialized,
    digest: grant.digest,
    note: "模型不能代簽。請委託人在皮夾以 passkey 生物辨識簽署這串 bytes。同意畫面文字已包含在簽署內容裡。",
  };
  assertNoVaultLeak(payload, "get_grant_for_signature");
  return payload;
}

export function redeem(grantIdRaw: string, agencyRaw: string) {
  const grantId = requireGrantId(grantIdRaw);
  const agency = requireAgency(agencyRaw);
  const { result } = redeemGrant(grantId, makeAgencyProof(agency, grantId));

  if (result.ok) {
    const payload = {
      ok: true as const,
      grantId: result.grantId,
      deliveredTo: result.deliveredTo,
      claimIds: result.claimIds,
      claimLabels: claimLabels(result.claimIds),
      note: "兩把鑰匙都通過。述詞值直接進入機關收件匣，不回傳給模型。",
    };
    assertNoVaultLeak(payload, "redeem_grant");
    return payload;
  }

  const payload = {
    ok: false as const,
    status: 403 as const,
    code: result.code,
    error: result.error,
    failedKey: result.failedKey ?? null,
    deniedClaims: result.deniedClaims ?? [],
    audited: true,
  };
  assertNoVaultLeak(payload, "redeem_grant");
  return payload;
}

export function requestClaimsTool(agencyRaw: string, purposeRaw: string, claims: string[]) {
  const agency = requireAgency(agencyRaw);
  if (!isPurposeId(purposeRaw)) throw new Error(`未登記的目的：${purposeRaw}`);
  const { blocked, notes } = requestClaims(agency, purposeRaw, claims);
  const payload = {
    ok: !blocked,
    blocked,
    agency,
    purpose: purposeRaw,
    requested: claims,
    requestedLabels: claimLabels(claims),
    notes,
    note: blocked
      ? "提案階段即攔截，委託人根本不會看到可以按的同意按鈕。"
      : "在法定職務範圍內，可交由委託人決定是否簽署。",
  };
  assertNoVaultLeak(payload, "request_claims");
  return payload;
}

export function submitApp(grantIdRaw: string) {
  const grantId = requireGrantId(grantIdRaw);
  const { error } = submitApplication(grantId);
  const payload = error
    ? { ok: false, error, grant: grantPublic(grantId) }
    : { ok: true, grant: grantPublic(grantId), note: `已送出。匣 ${grantId} 已耗用。` };
  assertNoVaultLeak(payload, "submit_application");
  return payload;
}

export function revokeGrantTool(grantIdRaw: string, reason?: string) {
  const grantId = requireGrantId(grantIdRaw);
  const { error } = revokeGrant(grantId, reason?.trim() || `委託人撤銷匣 ${grantId}`);
  const payload = error
    ? { ok: false, error, grant: grantPublic(grantId) }
    : { ok: true, grant: grantPublic(grantId), note: `匣 ${grantId} 已撤銷。` };
  assertNoVaultLeak(payload, "revoke_grant");
  return payload;
}

export function stopDelegationTool(reason?: string) {
  revokeDelegation(reason?.trim() || "委託人停止委託");
  const payload = {
    ok: true,
    delegationActive: false,
    note: "委託已停止，未兌現的匣全部作廢，之後任何兌現都會被擋。已交付機關的述詞收不回來。",
  };
  assertNoVaultLeak(payload, "stop_delegation");
  return payload;
}

export function getAudit() {
  const state = getState();
  const untouched = state.vaultCatalog.filter(
    (entry) =>
      !state.wallet.some((c) => CLAIM_DEFS[c.claimId].derivedFrom.includes(entry.fieldId)),
  );
  const payload = {
    ok: true,
    delegationActive: state.delegation.active,
    usedJti: state.usedJti.length,
    vaultFieldsNeverUsed: untouched.map((e) => e.fieldId),
    grants: state.grants.map((g) => ({
      id: g.id,
      status: g.status,
      claimIds: g.body.claims,
      signed: Boolean(g.signature),
      risk: g.risk,
    })),
    // Credential metadata only: no values, not even predicate values.
    wallet: state.wallet.map((c) => ({
      claimId: c.claimId,
      issuer: c.issuer,
      audience: c.audience,
      expiresAt: c.expiresAt,
      presentedCount: c.presentedCount,
    })),
    audit: state.audit.map((entry) => ({
      id: entry.id,
      at: entry.at,
      actor: entry.actor,
      actorRole: entry.actorRole,
      action: entry.action,
      grantId: entry.grantId,
      detail: entry.detail,
      deniedClaims: entry.deniedClaims ?? [],
      risk: entry.risk ?? null,
    })),
    note: "稽核只記動作，不含金庫值，也不含述詞的值。",
  };
  assertNoVaultLeak(payload, "get_audit");
  return payload;
}

export function callTool(
  name: ToolName,
  args: Record<string, unknown>,
): { data: unknown; isError: boolean } {
  const str = (key: string) => String(args[key] ?? "");
  switch (name) {
    case "search_purposes":
      return wrap(searchPurposes(str("query")));
    case "plan_applications":
      return wrap(planApplications(str("utterance")));
    case "get_grant_for_signature":
      return wrap(getGrantForSignature(str("grantId")));
    case "redeem_grant":
      return wrap(redeem(str("grantId"), str("agency")));
    case "request_claims":
      return wrap(
        requestClaimsTool(
          str("agency"),
          str("purpose"),
          Array.isArray(args.claims) ? (args.claims as string[]) : [],
        ),
      );
    case "submit_application":
      return wrap(submitApp(str("grantId")));
    case "revoke_grant":
      return wrap(revokeGrantTool(str("grantId"), args.reason ? str("reason") : undefined));
    case "stop_delegation":
      return wrap(stopDelegationTool(args.reason ? str("reason") : undefined));
    case "get_audit":
      return wrap(getAudit());
    default:
      return { data: { ok: false, error: `未知工具：${name}` }, isError: true };
  }
}

function wrap(data: unknown): { data: unknown; isError: boolean } {
  const isError = Boolean(data && typeof data === "object" && (data as { ok?: boolean }).ok === false);
  return { data, isError };
}
