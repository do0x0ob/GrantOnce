import {
  makeAgencyProof,
  proposeGrantsFromPlan,
  redeemGrant,
  requestClaims,
  revokeDelegation,
  revokeGrant,
  submitApplication,
} from "../lib/authz";
import { pushChanges, runAgentTick } from "../lib/agent";
import { catalogPublic, searchCatalog } from "../lib/catalog";
import { CLAIM_DEFS, isClaimId, SENSITIVITY_LABEL } from "../lib/claims";
import { normalizeGrantId } from "../lib/fields";
import { evaluateInquiry, formatInquiryMessage, inquiryPayload } from "../lib/inquiry";
import { isKnownAgency } from "../lib/parties";
import { isPurposeId, PURPOSES } from "../lib/purposes";
import { isLivePurposeId, livePurpose, livePurposes } from "../lib/registry-io";
import { researchWorld } from "../lib/research";
import { AGENT_NAME, AGENT_NOTES, effectiveToday, HAPPY_PATH_UTTERANCE } from "../lib/rules";
import {
  appendAudit,
  appendChat,
  getState,
  mutate,
  nowIso,
  reconcileApplications,
} from "../lib/store";
import type { ToolName } from "../lib/tools";
import type { AgencyId, AuditEntry, GrantId, Notification } from "../lib/types";
import { VAULT } from "../lib/vault";

export { TOOL_NAMES, type ToolName } from "../lib/tools";

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

/**
 * Values that cannot be told apart from ordinary JSON, so searching for them
 * would flag every payload rather than a leak: `true` and `false` are how every
 * boolean anywhere is written. Predicate values that read like these are
 * therefore undetectable by inspection, which is exactly why
 * `summaryForAgent` is written to avoid stating any value at all rather than
 * relying on this check to catch it.
 */
const INDISTINGUISHABLE = new Set(["true", "false", "null"]);

/** Distinctive predicate values currently held in the wallet. */
export function claimValueMarkers(): string[] {
  return getState()
    .wallet.map((c) => c.value)
    .filter((v) => v.length >= 3 && !INDISTINGUISHABLE.has(v));
}

/**
 * Predicate values are as off-limits to the model as vault values are.
 *
 * `get_audit` already promises 「不含述詞的值」. Notifications are written by the
 * same code and go to the same reader, so the promise has to hold there too:
 * the age band is a value about a child, whether it arrives labelled as a claim
 * or buried in the prose of a push notice.
 */
export function claimValueLeakIn(payload: unknown): string | null {
  const blob = JSON.stringify(payload);
  for (const value of claimValueMarkers()) {
    if (blob.includes(value)) return value;
  }
  return null;
}

export function assertNoClaimValueLeak(payload: unknown, where: string) {
  const leak = claimValueLeakIn(payload);
  if (leak) throw new Error(`${where} leaked a predicate value to the model: ${leak}`);
}

/** Both privacy invariants, for the tools that read state back to the model. */
function assertModelSafe(payload: unknown, where: string) {
  assertNoVaultLeak(payload, where);
  assertNoClaimValueLeak(payload, where);
}

function claimLabels(ids: readonly string[]): string[] {
  return ids.map((id) => (isClaimId(id) ? CLAIM_DEFS[id].label : id));
}

function requireGrantId(raw: string): GrantId {
  const grantId = normalizeGrantId(raw);
  if (!grantId) {
    throw new Error(`無效的匣編號：${raw}（可用 G-甲 / G-jia、G-乙 / G-yi 或 G-丙 / G-bing）`);
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
    programTitle: (livePurpose(grant.body.purpose) ?? PURPOSES[grant.body.purpose])?.title ?? grant.body.purpose,
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

export async function searchPurposes(query: string) {
  const world = await researchWorld(query);
  const hits = searchCatalog(query, Object.values(livePurposes()));
  const payload = {
    ok: true,
    query,
    world,
    issuable: hits.map(catalogPublic),
    matches: hits.map(catalogPublic),
    issuablePurposeIds: hits
      .filter((entry) => entry.issuable && entry.purposeId)
      .map((entry) => entry.purposeId),
    note: "world 是公開搜尋。issuable 才是本 runtime 能 mint Grant 的子集。不要把登記表當成全世界。不能發明述詞。",
    notes: [...AGENT_NOTES],
  };
  assertNoVaultLeak(payload, "search_purposes");
  return payload;
}

export async function planApplications(utterance: string) {
  const message = utterance.trim() || HAPPY_PATH_UTTERANCE;
  const today = effectiveToday(getState());
  const inquiry = evaluateInquiry(message, today);
  const world = await researchWorld(message);

  mutate((s) => {
    appendChat(s, "user", message);
    appendChat(s, "agent", formatInquiryMessage(inquiry, today, world));
    if (!inquiry.canIssue) return;
    s.plan = { utterance: message, matchedAt: new Date().toISOString() };
    proposeGrantsFromPlan(s, inquiry.programs);
    pushChanges(s, new Date());
  });

  const payload = {
    ...inquiryPayload(
      inquiry,
      [
        "模型無法簽署。請委託人在皮夾用生物辨識簽署後才能兌現。",
        "搜到真實世界的補助不會自動發票。只有 canIssue 時才會提案。",
      ],
      world,
    ),
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
  if (!isLivePurposeId(purposeRaw) && !isPurposeId(purposeRaw)) throw new Error(`未登記的目的：${purposeRaw}`);
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
  if (!error) mutate(reconcileApplications);
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

/**
 * Where a `since` cursor points into the audit trail.
 *
 * Accepts an entry id or an ISO timestamp. An unusable cursor falls back to the
 * full trail with a note rather than throwing: a long-running agent that lost
 * its place should get the whole picture, not an error.
 */
function auditSlice(
  audit: AuditEntry[],
  since?: string,
): { entries: AuditEntry[]; note: string | null } {
  const cursor = since?.trim();
  if (!cursor) return { entries: audit, note: null };

  const byId = audit.findIndex((e) => e.id === cursor);
  if (byId >= 0) return { entries: audit.slice(byId + 1), note: null };

  const at = Date.parse(cursor);
  if (Number.isFinite(at)) {
    return { entries: audit.filter((e) => Date.parse(e.at) > at), note: null };
  }
  return {
    entries: audit,
    note: `since「${cursor}」不是稽核編號，也不是可解析的時間，已改回全量。`,
  };
}

export function getAudit(since?: string) {
  const state = getState();
  const untouched = state.vaultCatalog.filter(
    (entry) =>
      !state.wallet.some((c) => CLAIM_DEFS[c.claimId].derivedFrom.includes(entry.fieldId)),
  );
  const slice = auditSlice(state.audit, since);
  const payload = {
    ok: true,
    delegationActive: state.delegation.active,
    lastTickAt: state.lastTickAt,
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
    audit: slice.entries.map((entry) => ({
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
    /** Hand this back as `since` next time to pick up where this left off. */
    cursor: state.audit.at(-1)?.id ?? null,
    note: [
      "稽核只記動作，不含金庫值，也不含述詞的值。",
      slice.note,
    ]
      .filter(Boolean)
      .join(" "),
  };
  assertModelSafe(payload, "get_audit");
  return payload;
}

/** What the model is allowed to see of a notification. Never `body`. */
function notificationForAgent(n: Notification) {
  return {
    id: n.id,
    key: n.key,
    at: n.at,
    kind: n.kind,
    severity: n.severity,
    title: n.title,
    summary: n.summaryForAgent,
    grantId: n.grantId,
    suggestedAction: n.suggestedAction,
    acknowledged: n.acknowledged,
  };
}

/**
 * The agent reading its own outbox.
 *
 * A watch pass runs first, so a client that only ever polls this still gets a
 * fresh answer — the loop is not something the principal has to trigger.
 */
export function getNotifications(options: { unacknowledgedOnly?: boolean; since?: string } = {}) {
  runAgentTick();
  const state = getState();
  const since = options.since ? Date.parse(options.since) : NaN;

  const notifications = state.notifications
    .filter((n) => (options.unacknowledgedOnly ? !n.acknowledged : true))
    .filter((n) => (Number.isFinite(since) ? Date.parse(n.at) > since : true))
    .map(notificationForAgent);

  const payload = {
    ok: true,
    lastTickAt: state.lastTickAt,
    notifications,
    note: "推播只描述發生了什麼，不含金庫值，也不含述詞的值。",
  };
  assertModelSafe(payload, "get_notifications");
  return payload;
}

export function acknowledgeNotification(id: string) {
  let found: Notification | null = null;
  mutate((s) => {
    const n = s.notifications.find((x) => x.id === id.trim());
    if (!n) return;
    if (!n.acknowledged) {
      n.acknowledged = true;
      n.acknowledgedAt = nowIso();
      appendAudit(s, {
        actor: AGENT_NAME,
        actorRole: "agent",
        action: "acknowledge",
        grantId: n.grantId,
        detail: `簽收推播：${n.title}`,
      });
    }
    found = n;
  });

  const payload: Record<string, unknown> = found
    ? {
        ok: true,
        notification: notificationForAgent(found),
        note: "已簽收。簽收只表示看過了，不會授權任何事。",
      }
    : { ok: false, error: `找不到推播 ${id}` };
  assertModelSafe(payload, "acknowledge_notification");
  return payload;
}

type PendingAction = {
  id: string;
  blockedOn: "principal" | "agency" | "issuer" | "agent";
  what: string;
  grantId: GrantId | null;
  suggestedTool: ToolName | null;
  suggestedArgs: Record<string, string>;
  deadline: string | null;
};

/**
 * Derived, never stored: what is stuck, on whom, and which tool moves it.
 *
 * Every `suggestedTool` is a name from `TOOL_NAMES`, and none of those signs
 * anything — so the most an agent can do by following this list to the letter
 * is show the principal what they would be signing.
 */
export function getPendingActions() {
  const state = getState();
  const actions: PendingAction[] = [];
  const utterance = state.plan?.utterance ?? HAPPY_PATH_UTTERANCE;

  if (!state.delegation.active) {
    actions.push({
      id: "delegation:stopped",
      blockedOn: "principal",
      what: "委託已停用，任何兌現都會被擋",
      grantId: null,
      suggestedTool: null,
      suggestedArgs: {},
      deadline: null,
    });
  }

  for (const grant of state.grants) {
    if (grant.status === "proposed") {
      actions.push({
        id: `awaiting-sign:${grant.id}:${grant.body.jti}`,
        blockedOn: "principal",
        what: "等委託人以生物辨識簽署",
        grantId: grant.id,
        suggestedTool: "get_grant_for_signature",
        suggestedArgs: { grantId: grant.id },
        deadline: grant.body.exp,
      });
    }
    if (grant.status === "signed") {
      actions.push({
        id: `awaiting-redeem:${grant.id}:${grant.body.jti}`,
        blockedOn: "agency",
        what: "等機關以自己的金鑰兌現",
        grantId: grant.id,
        suggestedTool: "redeem_grant",
        suggestedArgs: { grantId: grant.id, agency: grant.body.aud },
        deadline: grant.body.exp,
      });
    }
    if (grant.status === "redeemed" && !state.inboxes[grant.body.aud].submittedAt) {
      actions.push({
        id: `awaiting-submit:${grant.id}:${grant.body.jti}`,
        blockedOn: "agent",
        what: "述詞已交付，可以送件",
        grantId: grant.id,
        suggestedTool: "submit_application",
        suggestedArgs: { grantId: grant.id },
        deadline: null,
      });
    }
  }

  for (const inbox of Object.values(state.inboxes)) {
    if (inbox.lastDenial && inbox.lastDeniedAt) {
      actions.push({
        id: `denial:${inbox.agencyId}:${inbox.lastDeniedAt}`,
        blockedOn: "agent",
        what: "上一次請求被拒，需要重新提案",
        grantId: null,
        suggestedTool: "plan_applications",
        suggestedArgs: { utterance },
        deadline: null,
      });
    }
    if (inbox.applicationStatus === "needs-more") {
      actions.push({
        id: `needs-more:${inbox.agencyId}`,
        blockedOn: "principal",
        what: "機關要求補件",
        grantId: null,
        suggestedTool: null,
        suggestedArgs: {},
        deadline: null,
      });
    }
  }

  // A programme whose claims the wallet can no longer prove is waiting on the
  // issuer, not on anyone here.
  const now = new Date();
  const neededClaims = new Set(
    state.grants.flatMap((g) => (g.status === "redeemed" ? [] : g.body.claims)),
  );
  for (const cred of state.wallet) {
    if (cred.revoked) continue;
    if (!neededClaims.has(cred.claimId)) continue;
    if (new Date(cred.expiresAt).getTime() > now.getTime()) continue;
    actions.push({
      id: `credential:expired:${cred.id}`,
      blockedOn: "issuer",
      what: "等發證機構重新簽發已到期的憑證",
      grantId: null,
      suggestedTool: null,
      suggestedArgs: {},
      deadline: cred.expiresAt,
    });
  }

  const payload = {
    ok: true,
    lastTickAt: state.lastTickAt,
    actions,
    note: "建議的下一步永遠不是簽署——工具清單裡沒有簽署工具。",
  };
  assertModelSafe(payload, "get_pending_actions");
  return payload;
}

export async function callTool(
  name: ToolName,
  args: Record<string, unknown>,
): Promise<{ data: unknown; isError: boolean }> {
  const str = (key: string) => String(args[key] ?? "");
  switch (name) {
    case "search_purposes":
      return wrap(await searchPurposes(str("query")));
    case "plan_applications":
      return wrap(await planApplications(str("utterance")));
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
      return wrap(getAudit(args.since ? str("since") : undefined));
    case "get_notifications":
      return wrap(
        getNotifications({
          unacknowledgedOnly: args.unacknowledgedOnly === true,
          since: args.since ? str("since") : undefined,
        }),
      );
    case "acknowledge_notification":
      return wrap(acknowledgeNotification(str("id")));
    case "get_pending_actions":
      return wrap(getPendingActions());
    default:
      return { data: { ok: false, error: `未知工具：${name}` }, isError: true };
  }
}

function wrap(data: unknown): { data: unknown; isError: boolean } {
  const isError = Boolean(data && typeof data === "object" && (data as { ok?: boolean }).ok === false);
  return { data, isError };
}
