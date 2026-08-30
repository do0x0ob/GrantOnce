import { CLAIM_DEFS, ISSUERS, isClaimId, type ClaimId, type IssuerId } from "./claims";
import { digest, randomId, serializeBody, sign, thumbprint, unb64u, verify } from "./crypto";

import { AGENCY_KEYS, AGENCY_NAMES, isKnownAgency } from "./parties";
import { claimsOutsidePurpose, normalizeGrantId, PURPOSES, type PurposeId } from "./purposes";
import { purposesFrom } from "./registry";
import { assessRisk } from "./risk";
import { effectiveNow } from "./rules";
import { appendAudit, emptyInbox, getState, grantById, mutate, notify, nowIso, purposeOf } from "./store";
import type {
  AgencyId,
  ServiceRequest,
  AgencyInbox,
  DemoState,
  Grant,
  GrantBody,
  GrantId,
  ProgramPlan,
  RedeemProof,
  RedeemResult,
} from "./types";
import { formatStamp, GRANT_STATUS_LABEL } from "./view";
import { ensureCredentials, findValidCredential, verifyCredential } from "./wallet";

function actorFor(agency: AgencyId): { name: string; role: "agency-jia" | "agency-yi" } {
  return {
    name: AGENCY_NAMES[agency],
    role: agency === "jia" ? "agency-jia" : "agency-yi",
  };
}

/**
 * The inbox for a purpose, created on first touch. Only the builtins get one at
 * reset, so a purpose an agency hangs on the registry desk would otherwise be
 * written through `undefined` the first time anything is redeemed against it.
 */
function inboxFor(state: DemoState, purpose: PurposeId): AgencyInbox {
  const existing = state.inboxes[purpose];
  if (existing) return existing;
  const created = emptyInbox(purpose, purposesFrom(state)[purpose]);
  state.inboxes[purpose] = created;
  return created;
}

function stampDenial(state: DemoState, purpose: PurposeId | null, error: string) {
  if (!purpose) return;
  const inbox = inboxFor(state, purpose);
  inbox.lastDenial = error;
  inbox.lastDeniedAt = nowIso();
}

/** The consent wording, signed alongside everything else so the record proves
 *  what was displayed, not merely that the principal tapped. */
function purposeOn(state: DemoState, purpose: PurposeId) {
  return purposesFrom(state)[purpose];
}

function sourcesForClaims(claims: ClaimId[]): IssuerId[] {
  return [...new Set(claims.map((claim) => CLAIM_DEFS[claim].issuer))];
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

const DATA_SUBJECT_RIGHTS =
  "你可以依法查詢、閱覽、請求複製、更正、停止蒐集處理利用或刪除；可透過辦理機關臨櫃或其公告的線上管道提出。已合法交付並進入案件處理的資料，依適用法令與保存義務辦理。";

function serviceBindingError(state: DemoState, grant: Grant): string | null {
  const request = state.serviceRequests.find((item) => item.id === grant.body.requestId);
  const def = purposeOn(state, grant.body.purpose);
  if (!request || !def) return "找不到完整、已登記的服務需求。";
  const expectedSources = sourcesForClaims(grant.body.claims.filter(isClaimId));
  const expectedCategories = grant.body.claims.filter(isClaimId).map((claim) => CLAIM_DEFS[claim].label);
  if (
    request.grantId !== grant.id ||
    request.purpose !== grant.body.purpose ||
    request.title !== def.title ||
    request.requester !== grant.body.aud ||
    request.requesterName !== def.agencyName ||
    !sameSet(request.claims, grant.body.claims) ||
    !sameSet(request.dataSources, grant.body.dataSources) ||
    !sameSet(request.privacyBasis, def.privacyBasis) ||
    request.necessity !== def.necessity ||
    !sameSet(grant.body.dataSources, expectedSources) ||
    grant.body.requester.agency !== grant.body.aud ||
    grant.body.requester.name !== def.agencyName ||
    grant.body.delivery.mode !== "issuer-to-requester" ||
    grant.body.delivery.recipient !== grant.body.aud ||
    grant.body.delivery.recipientJkt !== grant.body.cnf.jkt ||
    grant.body.notice.collector !== def.agencyName ||
    grant.body.notice.purpose !== def.title ||
    !sameSet(grant.body.notice.dataCategories, expectedCategories) ||
    grant.body.notice.period !== def.retentionPolicy ||
    grant.body.notice.area !== def.processingArea ||
    !sameSet(grant.body.notice.recipients, [def.agencyName]) ||
    grant.body.notice.method !== def.processingMethod ||
    grant.body.notice.rights !== DATA_SUBJECT_RIGHTS ||
    grant.body.notice.declineEffect !== def.declineEffect
  ) {
    return "服務需求、直接交付設定或個資告知事項與登記內容不一致。";
  }
  return null;
}

export function buildDisplayText(
  purpose: PurposeId,
  claims: ClaimId[],
  expIso: string,
  def = PURPOSES[purpose],
): string {
  const sources = sourcesForClaims(claims).map((source) => ISSUERS[source].name);
  const lines = [
    `「${def.title}」服務由 ${def.agencyName} 辦理。以下資料將由 ${sources.join("、")} 直接提供給該機關：`,
    ...claims.map((c) => `• ${CLAIM_DEFS[c].label}（${CLAIM_DEFS[c].shape}）`),
    "",
    def.necessity,
    "",
    `蒐集機關：${def.agencyName}`,
    `蒐集目的：辦理「${def.title}」`,
    `資料類別：${claims.map((c) => CLAIM_DEFS[c].label).join("、")}`,
    `利用期間：${def.retentionPolicy}`,
    `利用地區：${def.processingArea}`,
    `利用對象：${def.agencyName}`,
    `利用方式：${def.processingMethod}`,
    `當事人權利：${DATA_SUBJECT_RIGHTS}`,
    `不提供的影響：${def.declineEffect}`,
    "資料流：資料來源機關 → 請求機關；語言模型 Agent 不接收資料內容。",
    "",
    `個資依據：${def.privacyBasis.join("；")}`,
    ...(def.programBasis ? [`作用法：${def.programBasis.join("；")}`] : []),
    `有效至 ${formatStamp(expIso)}（台北時間），僅能使用一次，且只有「${def.agencyName}」能兌現。`,
  ];
  return lines.join("\n");
}

function buildGrant(
  state: DemoState,
  input: { grantId: GrantId; requestId: string; purpose: PurposeId; claims: ClaimId[] },
  now: Date,
): Grant {
  const def = purposeOn(state, input.purpose);
  if (!def) {
    throw new Error(`目的「${input.purpose}」未掛在登記台，不能建匣。`);
  }
  const ttl = Math.min(state.delegation.grantTtlSeconds, def.maxTtlSeconds);
  const exp = new Date(now.getTime() + ttl * 1000).toISOString();
  const displayText = buildDisplayText(input.purpose, input.claims, exp, def);
  const dataSources = sourcesForClaims(input.claims);
  const requesterJkt = AGENCY_KEYS[def.agency].jkt;

  const body: GrantBody = {
    aud: def.agency,
    claims: input.claims,
    cnf: { jkt: requesterJkt },
    requestId: input.requestId,
    requester: { agency: def.agency, name: def.agencyName },
    dataSources,
    delivery: {
      mode: "issuer-to-requester",
      recipient: def.agency,
      recipientJkt: requesterJkt,
    },
    notice: {
      collector: def.agencyName,
      purpose: def.title,
      dataCategories: input.claims.map((claim) => CLAIM_DEFS[claim].label),
      period: def.retentionPolicy,
      area: def.processingArea,
      recipients: [def.agencyName],
      method: def.processingMethod,
      rights: DATA_SUBJECT_RIGHTS,
      declineEffect: def.declineEffect,
    },
    displayText,
    exp,
    iat: now.toISOString(),
    iss: state.principal.id,
    jti: randomId("jti"),
    purpose: input.purpose,
  };
  const serialized = serializeBody(body);

  const risk = assessRisk({
    purpose: input.purpose,
    claims: input.claims,
    delegation: state.delegation,
    recentAudit: state.audit,
    now,
    purposes: purposesFrom(state),
  });

  return {
    id: input.grantId,
    body,
    serialized,
    digest: digest(serialized),
    signature: null,
    signedByKey: null,
    signMethod: null,
    status: "proposed",
    risk: risk.level,
    riskNotes: risk.notes,
    proposedAt: now.toISOString(),
    signedAt: null,
    redeemedAt: null,
    revokedAt: null,
  };
}

/**
 * Stage 2 — the registered service states what it needs, and nothing is minted.
 *
 * This used to be fused with the minting below, so a requirement arrived already
 * `awaiting-signature`: a signable capsule sat in state for a service the person
 * had never said they wanted, and the 個資法 check ran before they had agreed to
 * anything. Opening the requirement on its own puts those back in order.
 */
export function openServiceRequests(state: DemoState, programs: ProgramPlan[]): ServiceRequest[] {
  const now = new Date();
  const opened: ServiceRequest[] = [];
  for (const program of programs) {
    for (const existing of state.serviceRequests) {
      if (
        existing.purpose === program.purpose &&
        (existing.status === "awaiting-confirmation" ||
          existing.status === "awaiting-signature" ||
          existing.status === "authorized")
      ) {
        existing.status = "cancelled";
      }
    }
    const def = purposeOn(state, program.purpose);
    const request: ServiceRequest = {
      id: randomId("req"),
      grantId: null,
      purpose: program.purpose,
      title: program.title,
      requester: program.agencyId,
      requesterName: program.agencyName.replace(/^[甲乙丙]｜/, ""),
      claims: [...program.claims],
      dataSources: sourcesForClaims(program.claims),
      privacyBasis: [...(def?.privacyBasis ?? [])],
      necessity: def?.necessity ?? "",
      status: "awaiting-confirmation",
      checkNotes: [],
      requestedAt: now.toISOString(),
      confirmedAt: null,
      authorizedAt: null,
      deliveredAt: null,
      processingAt: null,
      completedAt: null,
      resultSummary: null,
    };
    state.serviceRequests.push(request);
    opened.push(request);

    appendAudit(state, {
      actor: `${def?.agencyName ?? program.agencyName}（服務端）`,
      actorRole: program.agencyId === "jia" ? "agency-jia" : "agency-yi",
      action: "request",
      grantId: null,
      detail: `已登記服務「${program.title}」回傳本次必要需求：${program.claims
        .map((claim) => CLAIM_DEFS[claim].label)
        .join("、")}；資料來源為 ${request.dataSources
        .map((source) => ISSUERS[source].name)
        .join("、")}。需求不是授權，等待本人確認後才會做目的與最小範圍檢查。`,
      risk: "low",
    });
  }
  return opened;
}

/**
 * Stages 3–4 — the person has confirmed, so now the registry and 個資法 check
 * runs and, if it passes, a capsule is minted for them to sign.
 *
 * Returns null when the id names nothing confirmable, so a repeated confirmation
 * cannot mint a second capsule for the same requirement.
 */
export function confirmServiceRequest(
  state: DemoState,
  requestId: string,
): ServiceRequest | null {
  const request = state.serviceRequests.find((item) => item.id === requestId);
  if (!request || request.status !== "awaiting-confirmation") return null;

  const now = new Date();
  const def = purposeOn(state, request.purpose);
  request.confirmedAt = now.toISOString();

  // Not on the registry desk: there is nothing to check against and nothing to
  // mint. The refusal is recorded against the requirement, not against a capsule
  // that was never built.
  if (!def) {
    request.status = "blocked";
    request.checkNotes = [`目的「${request.purpose}」未掛在登記台，不能建匣。`];
    appendAudit(state, {
      actor: "目的登記表",
      actorRole: "system",
      action: "deny",
      grantId: null,
      detail: `確認後檢查未過：${request.checkNotes.join(" ")}`,
      risk: "blocked",
    });
    return request;
  }

  const fresh = buildGrant(
    state,
    {
      grantId: def.slot,
      requestId: request.id,
      purpose: request.purpose,
      claims: request.claims,
    },
    now,
  );

  request.grantId = fresh.id;
  request.dataSources = [...fresh.body.dataSources];
  request.checkNotes = [...fresh.riskNotes];
  request.status = fresh.risk === "blocked" ? "blocked" : "awaiting-signature";

  const idx = state.grants.findIndex((g) => g.id === fresh.id);
  // A proposal always replaces a stale one: a new jti, a new expiry, a new
  // signature. Grants are never reactivated in place.
  if (idx >= 0) state.grants[idx] = fresh;
  else state.grants.push(fresh);

  appendAudit(state, {
    actor: "目的登記表",
    actorRole: "system",
    action: fresh.risk === "blocked" ? "deny" : "request",
    grantId: fresh.id,
    detail:
      fresh.risk === "blocked"
        ? `本人確認後仍遭目的與最小範圍檢查攔截：${fresh.riskNotes.join(" ")}`
        : `本人已確認「${request.title}」的需求。目的在登記表內，個資依據為 ${def.privacyBasis.join(
            "；",
          )}，述詞 ${request.claims.length} 項均在該目的上限內，已備妥授權匣待簽。`,
    risk: fresh.risk,
  });

  return request;
}

/**
 * Open a requirement and confirm it in one step.
 *
 * The direct path, where an agency asks on its own behalf and there is no
 * separate person to check back with mid-way. The conversational flow uses the
 * two halves above instead, so confirmation is a beat the person actually takes.
 */
export function proposeGrantsFromPlan(state: DemoState, programs: ProgramPlan[]) {
  for (const request of openServiceRequests(state, programs)) {
    confirmServiceRequest(state, request.id);
  }
}

export function requestClaims(
  agency: AgencyId,
  purpose: PurposeId,
  claims: string[],
): {
  state: DemoState;
  blocked: boolean;
  notes: string[];
  grantId: GrantId | null;
  requestId: string | null;
} {
  let blocked = false;
  let notes: string[] = [];
  let grantId: GrantId | null = null;
  let requestId: string | null = null;
  const now = new Date();

  const state = mutate((s) => {
    const recognizedClaims = claims.filter(isClaimId);
    const risk = assessRisk({
      purpose,
      claims,
      delegation: s.delegation,
      recentAudit: s.audit,
      now,
      purposes: purposesFrom(s),
    });
    notes = risk.notes;
    blocked = risk.level === "blocked";

    const live = purposeOn(s, purpose);
    // The requester must be the agency the purpose belongs to. Without this,
    // 乙 could ask for childcare claims and be told the request is fine.
    if (!live || live.agency !== agency) {
      notes = [
        live
          ? `「${live.title}」是 ${AGENCY_NAMES[live.agency]} 的法定職務，${AGENCY_NAMES[agency]} 不能以此目的索取資料。`
          : `「${purpose}」不是已登記服務，${AGENCY_NAMES[agency]} 不能以此目的索取資料。`,
        ...notes,
      ];
      blocked = true;
    }

    if (!claims.length) {
      notes = ["服務沒有列出任何必要資料，不能建立空白授權。", ...notes];
      blocked = true;
    }
    if (recognizedClaims.length !== claims.length) {
      notes = ["服務需求含有未登記的資料欄位。", ...notes];
      blocked = true;
    }

    const actor = actorFor(agency);
    if (blocked) {
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        grantId: null,
        detail: `服務需求遭攔截：${notes.join(" ")}`,
        deniedClaims: risk.blockedClaims,
        risk: "blocked",
      });
      stampDenial(s, purpose, notes.join(" ") || "請求遭攔截。");
      notify(s, {
        kind: "risk",
        title: `攔截了 ${AGENCY_NAMES[agency]} 的逾越請求`,
        body: notes.join("\n"),
        grantId: null,
      });
      return;
    }

    if (!live) return;

    proposeGrantsFromPlan(s, [
      {
        grantId: live.slot,
        purpose: live.id,
        title: live.title,
        agencyId: live.agency,
        agencyName: live.agencyName,
        reasons: ["服務端依目的登記內容回傳本次辦理所需的最小資料。"],
        claims: recognizedClaims,
      },
    ]);
    const grant = grantById(s, live.slot);
    grantId = grant?.id ?? null;
    requestId = grant?.body.requestId ?? null;
  });

  return { state, blocked, notes, grantId, requestId };
}

export function registerPrincipalKey(input: {
  publicKey: string;
  method: "passkey" | "software";
  credentialId?: string | null;
}): { state: DemoState; error?: string } {
  let error: string | undefined;
  const state = mutate((s) => {
    try {
      if (unb64u(input.publicKey).length !== 32) {
        error = "公鑰長度不正確，應為 32 bytes 的 ed25519 公鑰";
        return;
      }
    } catch {
      error = "公鑰不是合法的 base64url";
      return;
    }
    s.principal.key = {
      publicKey: input.publicKey,
      method: input.method,
      registeredAt: nowIso(),
      credentialId: input.credentialId ?? null,
    };
    appendAudit(s, {
      actor: s.principal.name,
      actorRole: "principal",
      action: "register",
      detail:
        input.method === "passkey"
          ? "以 passkey（生物辨識）派生的簽章金鑰註冊皮夾。私鑰不離開裝置，伺服器只存公鑰。"
          : "以軟體金鑰註冊皮夾（demo 備援，安全性弱於 passkey）。",
    });
  });
  return { state, error };
}

/** Verifies the principal's signature over the exact serialized grant. */
export function signGrant(input: {
  grantId: GrantId;
  signature: string;
  publicKey: string;
}): { state: DemoState; error?: string } {
  let error: string | undefined;
  const state = mutate((s) => {
    const grant = grantById(s, input.grantId);
    if (!grant) {
      error = `找不到匣 ${input.grantId}。`;
      return;
    }
    if (grant.status !== "proposed") {
      error = `匣 ${input.grantId} 目前是「${GRANT_STATUS_LABEL[grant.status]}」，不能簽署。`;
      return;
    }
    if (grant.risk === "blocked") {
      error = `匣 ${input.grantId} 已被攔截，不可簽署：${grant.riskNotes.join(" ")}`;
      return;
    }
    if (new Date(grant.body.exp).getTime() < Date.now()) {
      grant.status = "expired";
      error = `匣 ${input.grantId} 已逾效期，請重新比對後簽署新的一張。`;
      return;
    }
    const registered = s.principal.key.publicKey;
    if (!registered) {
      error = "尚未註冊簽章金鑰，請先在皮夾註冊。";
      return;
    }
    if (registered !== input.publicKey) {
      error = "簽章公鑰與皮夾註冊的金鑰不符。";
      return;
    }
    if (!bodyMatchesSignedBytes(grant)) {
      error = "匣的欄位與待簽內容不一致，拒絕簽署。";
      return;
    }
    const serviceRequest = s.serviceRequests.find((request) => request.id === grant.body.requestId);
    const bindingError = serviceBindingError(s, grant);
    if (bindingError || serviceRequest?.status !== "awaiting-signature") {
      error = `服務需求無效：${bindingError ?? "這筆需求已不在等待簽署狀態。"}`;
      return;
    }
    if (!verify(input.signature, grant.serialized, unb64u(input.publicKey))) {
      error = "簽章驗證失敗，匣內容可能已被竄改。";
      appendAudit(s, {
        actor: s.principal.name,
        actorRole: "principal",
        action: "deny",
        grantId: grant.id,
        detail: "簽章驗證失敗，拒絕標記為已簽署。",
        risk: "blocked",
      });
      return;
    }

    grant.signature = input.signature;
    grant.signedByKey = input.publicKey;
    grant.signMethod = s.principal.key.method;
    grant.status = "signed";
    grant.signedAt = nowIso();
    serviceRequest.status = "authorized";
    serviceRequest.authorizedAt = grant.signedAt;

    appendAudit(s, {
      actor: s.principal.name,
      actorRole: "principal",
      action: "sign",
      grantId: grant.id,
      detail: `以${grant.signMethod === "passkey" ? " passkey 生物辨識" : "軟體金鑰"}簽署匣 ${grant.id}（${(purposeOn(s, grant.body.purpose) ?? PURPOSES[grant.body.purpose])?.title ?? grant.body.purpose}）。簽章涵蓋服務需求、請求機關、資料來源、直接交付方式、個資告知事項、jti／exp／述詞與畫面文字，摘要 ${grant.digest.slice(0, 12)}。`,
      risk: grant.risk,
    });
  });
  return { state, error };
}

/**
 * Demo helper standing in for the agency's own signing infrastructure. In
 * production this private key would never exist in this process.
 *
 * The proof commits to the capsule's digest, not merely its id: ids are reused
 * across proposals, so a proof captured from an earlier G-甲 would otherwise
 * replay against the next one.
 */
export function makeAgencyProof(agency: AgencyId, grantId: GrantId): RedeemProof {
  const body = {
    agency,
    digest: grantById(getState(), grantId)?.digest ?? "",
    grantId,
    iat: nowIso(),
    nonce: randomId("n"),
  };
  return { ...body, signature: sign(serializeBody(body), AGENCY_KEYS[agency].secret) };
}

/**
 * The signature covers `serialized`, but every check downstream reads
 * `grant.body`. If those two ever disagree, the signature is decorative: an
 * attacker with write access to the store could repoint `aud`, `cnf` or
 * `claims` while leaving the signed bytes untouched. Re-deriving the bytes and
 * comparing is what actually binds the decisions to the signature.
 */
function bodyMatchesSignedBytes(grant: Grant): boolean {
  return serializeBody(grant.body) === grant.serialized;
}

const PROOF_SKEW_MS = 120_000;

function verifyAgencyProof(proof: RedeemProof, grant: Grant): boolean {
  if (!isKnownAgency(proof.agency)) return false;
  if (proof.digest !== grant.digest) return false;
  const age = Date.now() - new Date(proof.iat).getTime();
  if (!Number.isFinite(age) || Math.abs(age) > PROOF_SKEW_MS) return false;
  const body = {
    agency: proof.agency,
    digest: proof.digest,
    grantId: proof.grantId,
    iat: proof.iat,
    nonce: proof.nonce,
  };
  return verify(proof.signature, serializeBody(body), AGENCY_KEYS[proof.agency].publicKey);
}

/**
 * Both keys must turn.
 *
 * Key one is the principal's signature over the grant. Key two is the agency
 * proving possession of the key the grant is bound to, plus the purpose registry
 * confirming the agency has statutory grounds to receive these claims. Neither
 * alone releases anything, and nothing partial is ever returned.
 */
export function redeemGrant(
  grantIdRaw: string,
  proof: RedeemProof,
): { state: DemoState; result: RedeemResult } {
  let result: RedeemResult = {
    ok: false,
    status: 403,
    code: "UNKNOWN_GRANT",
    error: "未知的匣。",
  };
  const now = new Date();

  const state = mutate((s) => {
    const claimer = isKnownAgency(proof.agency) ? proof.agency : null;
    const actor = claimer ? actorFor(claimer) : { name: "未知請求方", role: "system" as const };

    const fail = (
      code: Extract<RedeemResult, { ok: false }>["code"],
      error: string,
      extra?: { deniedClaims?: string[]; failedKey?: "principal" | "agency" },
    ) => {
      result = { ok: false, status: 403, code, error, ...extra };
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        grantId: normalizeGrantId(grantIdRaw),
        detail: `${code}：${error}`,
        deniedClaims: extra?.deniedClaims,
        risk: "blocked",
      });
      stampDenial(s, purposeOf(grantIdRaw), error);
    };

    const grantId = normalizeGrantId(grantIdRaw);
    if (!grantId) return fail("UNKNOWN_GRANT", `未知的匣：${grantIdRaw}。`);

    const grant = grantById(s, grantId);
    if (!grant) return fail("UNKNOWN_GRANT", `匣 ${grantId} 不存在。`);
    const serviceRequest = s.serviceRequests.find((request) => request.id === grant.body.requestId);

    // --- standing delegation -------------------------------------------------
    if (!s.delegation.active) {
      return fail("NO_DELEGATION", "委託已撤銷，所有兌現一律停止。", {
        failedKey: "principal",
      });
    }
    if (new Date(s.delegation.validUntil).getTime() < now.getTime()) {
      return fail("NO_DELEGATION", "委託已逾期。", { failedKey: "principal" });
    }

    // --- key one: the principal ---------------------------------------------
    if (grant.status === "revoked") {
      return fail("REVOKED", `匣 ${grantId} 已撤銷。`, { failedKey: "principal" });
    }
    if (grant.status === "redeemed" || s.usedJti.includes(grant.body.jti)) {
      return fail("REPLAYED", `匣 ${grantId} 已兌現，一次性授權不可重放。`, {
        failedKey: "principal",
      });
    }
    if (grant.status === "expired") {
      return fail("EXPIRED", `匣 ${grantId} 已逾效期（${grant.body.exp}）。`, {
        failedKey: "principal",
      });
    }
    if (grant.status !== "signed" || !grant.signature || !grant.signedByKey) {
      return fail("UNSIGNED", `匣 ${grantId} 尚未經委託人簽署。`, {
        failedKey: "principal",
      });
    }
    if (s.principal.key.publicKey !== grant.signedByKey) {
      return fail("BAD_SIGNATURE", "簽署金鑰已不是皮夾目前註冊的金鑰。", {
        failedKey: "principal",
      });
    }
    if (!verify(grant.signature, grant.serialized, unb64u(grant.signedByKey))) {
      return fail("BAD_SIGNATURE", "委託人簽章驗證失敗，匣內容遭竄改。", {
        failedKey: "principal",
      });
    }
    if (!bodyMatchesSignedBytes(grant)) {
      return fail("BAD_SIGNATURE", "匣的欄位與已簽署的內容不一致，拒絕兌現。", {
        failedKey: "principal",
      });
    }
    if (
      !serviceRequest ||
      serviceRequest.grantId !== grant.id ||
      serviceRequest.purpose !== grant.body.purpose
    ) {
      return fail(
        "INVALID_SERVICE_REQUEST",
        "匣沒有對應到完整、已登記的服務需求，拒絕調閱資料。",
        { failedKey: "agency" },
      );
    }
    if (new Date(grant.body.exp).getTime() < now.getTime()) {
      grant.status = "expired";
      return fail("EXPIRED", `匣 ${grantId} 已逾效期（${grant.body.exp}）。`, {
        failedKey: "principal",
      });
    }

    // --- key two: the agency -------------------------------------------------
    if (!claimer) {
      return fail("BAD_AGENCY_PROOF", "請求方不是登記在案的機關。", {
        failedKey: "agency",
      });
    }
    if (grant.body.aud !== claimer) {
      return fail(
        "WRONG_AUDIENCE",
        `匣 ${grantId} 的受眾是 ${AGENCY_NAMES[grant.body.aud]}，${AGENCY_NAMES[claimer]} 不能兌現。`,
        { failedKey: "agency" },
      );
    }
    if (serviceRequest.requester !== claimer) {
      return fail(
        "INVALID_SERVICE_REQUEST",
        "出示授權的機關不是服務需求單所登記的請求機關。",
        { failedKey: "agency" },
      );
    }
    if (proof.grantId !== grantId) {
      return fail("BAD_AGENCY_PROOF", "機關持有證明所指的匣與請求不符。", {
        failedKey: "agency",
      });
    }
    if (!verifyAgencyProof(proof, grant)) {
      return fail("BAD_AGENCY_PROOF", "機關持有證明無效、過期，或不是為這一張匣簽的。", {
        failedKey: "agency",
      });
    }
    if (thumbprint(AGENCY_KEYS[claimer].publicKey) !== grant.body.cnf.jkt) {
      return fail(
        "KEY_NOT_BOUND",
        "請求方金鑰與匣內 cnf 綁定的指紋不符，此匣不是 bearer token。",
        { failedKey: "agency" },
      );
    }

    // --- key two, part two: statutory purpose --------------------------------
    // assessRisk below repeats this, but a dedicated code says *which* rule
    // refused; RISK_BLOCKED alone reads as a generic denial.
    const purposeDef = purposeOn(s, grant.body.purpose);
    if (!purposeDef) {
      return fail("OUTSIDE_PURPOSE", `目的「${grant.body.purpose}」未掛在登記台，拒絕兌現。`, {
        failedKey: "agency",
      });
    }
    const outside = claimsOutsidePurpose(grant.body.purpose, grant.body.claims, purposesFrom(s));
    if (outside.length) {
      return fail(
        "OUTSIDE_PURPOSE",
        `${outside.map((c) => (isClaimId(c) ? CLAIM_DEFS[c].label : c)).join("、")} 逾越「${purposeDef.title}」的法定職務必要範圍，即使委託人已簽署仍拒絕。`,
        { deniedClaims: outside, failedKey: "agency" },
      );
    }
    if (purposeDef.agency !== claimer) {
      return fail("OUTSIDE_PURPOSE", "該目的不屬於此機關的法定職務。", {
        failedKey: "agency",
      });
    }
    const bindingError = serviceBindingError(s, grant);
    if (bindingError) {
      return fail(
        "INVALID_SERVICE_REQUEST",
        bindingError,
        { failedKey: "agency" },
      );
    }
    if (serviceRequest.status !== "authorized") {
      return fail(
        "INVALID_SERVICE_REQUEST",
        "服務需求不是已由使用者授權、等待資料交付的狀態。",
        { failedKey: "principal" },
      );
    }

    const risk = assessRisk({
      purpose: grant.body.purpose,
      claims: grant.body.claims,
      delegation: s.delegation,
      recentAudit: s.audit,
      now,
      purposes: purposesFrom(s),
    });
    if (risk.level === "blocked") {
      return fail("RISK_BLOCKED", risk.notes.join(" "), {
        deniedClaims: risk.blockedClaims,
      });
    }

    // --- present credentials -------------------------------------------------
    const claims = grant.body.claims.filter(isClaimId);
    // Credential lifetimes are in days, so they are judged against the demo
    // clock: a 30-day age band issued before the child turned two must not be
    // reused a year later.
    const credentialNow = effectiveNow(s);
    // Verify what the wallet already holds *before* issuing anything. Issuing
    // first and validating afterwards left new credentials — and a vault read —
    // behind on a failed redemption, with no issuance recorded in the audit.
    const staleCredential = claims
      .map((claimId) => findValidCredential(s, claimId, claimer, credentialNow))
      .find((cred) => cred && !verifyCredential(cred));
    if (staleCredential) {
      return fail("MISSING_CREDENTIAL", `憑證「${staleCredential.label}」的發證機構簽章無效。`);
    }

    const { issued, reused, credentials } = ensureCredentials(s, claims, claimer, credentialNow);
    const bad = credentials.find((c) => !verifyCredential(c));
    if (bad) {
      return fail("MISSING_CREDENTIAL", `憑證「${bad.label}」的發證機構簽章無效。`);
    }
    if (credentials.length !== claims.length) {
      return fail("MISSING_CREDENTIAL", "皮夾缺少本匣所需的憑證。");
    }

    for (const cred of credentials) cred.presentedCount += 1;

    for (const source of grant.body.dataSources) {
      const released = credentials.filter((credential) => credential.issuer === source);
      if (!released.length) continue;
      appendAudit(s, {
        actor: ISSUERS[source].name,
        actorRole: "issuer",
        action: "release",
        grantId: grant.id,
        detail: `驗證使用者簽章、請求機關持有證明、特定目的與最小範圍後，將 ${released.length} 項已簽章資格證明直接交付 ${purposeDef.agencyName}。語言模型 Agent 未接收資料內容。`,
        risk: risk.level,
      });
    }

    s.inboxes[grant.body.purpose] = {
      ...inboxFor(s, grant.body.purpose),
      purpose: grant.body.purpose,
      programTitle: purposeDef.title,
      claims: credentials.map((c) => ({
        claimId: c.claimId,
        label: c.label,
        value: c.value,
        sensitivity: c.sensitivity,
        issuer: c.issuer,
        issuerName: c.issuerName,
        issuerSignatureValid: verifyCredential(c),
      })),
      grantDigest: grant.digest,
      receivedAt: nowIso(),
      // A fresh redemption is a fresh application. Carrying the old timestamp
      // over made the second run refuse to submit.
      submittedAt: null,
      lastDenial: null,
      lastDeniedAt: null,
    };

    grant.status = "redeemed";
    grant.redeemedAt = nowIso();
    serviceRequest.status = "data-delivered";
    serviceRequest.deliveredAt = grant.redeemedAt;
    s.usedJti.push(grant.body.jti);

    if (issued.length) {
      appendAudit(s, {
        actor: "發證機構",
        actorRole: "issuer",
        action: "issue",
        grantId: grant.id,
        detail: `自金庫派生並簽發 ${issued.length} 張憑證：${issued.map((c) => CLAIM_DEFS[c].label).join("、")}。這是本流程唯一讀取金庫的一步。`,
      });
    }

    appendAudit(s, {
      actor: actor.name,
      actorRole: actor.role,
      action: "redeem",
      grantId: grant.id,
      detail: `雙鑰匙通過（委託人簽章 ✓ 請求機關持有證明 ✓ 法定目的 ✓），${grant.body.dataSources.map((source) => ISSUERS[source].name).join("、")} 將 ${claims.length} 項述詞直接交付 ${purposeDef.agencyName}${reused.length ? `；其中 ${reused.length} 項沿用皮夾既有憑證，未再調閱` : ""}。匣 ${grant.id} 就此耗用。`,
      risk: risk.level,
    });

    result = {
      ok: true,
      grantId: grant.id,
      claimIds: claims,
      deliveredTo: claimer,
      releasedBy: [...grant.body.dataSources],
    };
  });

  return { state, result };
}

export function revokeGrant(
  grantId: GrantId,
  reason: string,
): { state: DemoState; error?: string } {
  let error: string | undefined;
  const state = mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      error = `找不到匣 ${grantId}。`;
      return;
    }
    if (grant.status === "redeemed") {
      error = `匣 ${grantId} 已兌現。已交付的資料收不回來，只能停止後續取用。`;
      // Still burn the jti so nothing further can be done with it.
      if (!s.usedJti.includes(grant.body.jti)) s.usedJti.push(grant.body.jti);
      return;
    }
    if (grant.status !== "proposed" && grant.status !== "signed") {
      error = `匣 ${grantId} 目前是「${GRANT_STATUS_LABEL[grant.status]}」，不需要再撤銷。`;
      return;
    }
    grant.status = "revoked";
    grant.revokedAt = nowIso();
    const serviceRequest = s.serviceRequests.find((request) => request.id === grant.body.requestId);
    if (serviceRequest && serviceRequest.status !== "completed") {
      serviceRequest.status = "cancelled";
    }
    if (!s.usedJti.includes(grant.body.jti)) s.usedJti.push(grant.body.jti);
    appendAudit(s, {
      actor: s.principal.name,
      actorRole: "principal",
      action: "revoke",
      grantId,
      detail: reason,
    });
  });
  return { state, error };
}

/** The revocation that always works: stop this flow from accepting new signatures. */
export function revokeDelegation(reason: string): DemoState {
  return mutate((s) => {
    s.delegation.active = false;
    s.delegation.revokedAt = nowIso();
    s.delegation.revokedReason = reason;
    for (const grant of s.grants) {
      if (grant.status === "proposed" || grant.status === "signed") {
        grant.status = "revoked";
        grant.revokedAt = nowIso();
        if (!s.usedJti.includes(grant.body.jti)) s.usedJti.push(grant.body.jti);
      }
    }
    for (const request of s.serviceRequests) {
      if (request.status === "awaiting-signature" || request.status === "authorized") {
        request.status = "cancelled";
      }
    }
    appendAudit(s, {
      actor: s.principal.name,
      actorRole: "principal",
      action: "revoke",
      detail: `${reason}　委託停用，尚未兌現的匣一併作廢；已交付機關的資料無法收回，這是本設計誠實的邊界。`,
    });
  });
}

export function restoreDelegation(): DemoState {
  return mutate((s) => {
    s.delegation.active = true;
    s.delegation.revokedAt = null;
    s.delegation.revokedReason = null;
    s.delegation.validUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
    appendAudit(s, {
      actor: s.principal.name,
      actorRole: "principal",
      action: "register",
      detail: "重新啟用委託。既有已作廢的匣不會復活，需要重新比對與簽署。",
    });
  });
}

export function updateDelegation(
  patch: Partial<Pick<DemoState["delegation"], "maxSensitivity" | "agencies" | "purposes" | "grantTtlSeconds">>,
): DemoState {
  return mutate((s) => {
    Object.assign(s.delegation, patch);
    appendAudit(s, {
      actor: s.principal.name,
      actorRole: "principal",
      action: "register",
      detail: `更新委託範圍：${JSON.stringify(patch)}`,
    });
  });
}

export function submitApplication(grantId: GrantId): { state: DemoState; error?: string } {
  let error: string | undefined;
  const state = mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      error = `找不到匣 ${grantId}。`;
      return;
    }
    const purpose = purposeOf(grantId);
    if (!purpose) {
      error = `未知的匣：${grantId}。`;
      return;
    }
    const purposeDef = purposeOn(s, purpose);
    if (!purposeDef) {
      error = `目的「${purpose}」已下架，無法送件。`;
      return;
    }
    const who = actorFor(purposeDef.agency);
    const inbox = inboxFor(s, purpose);
    if (grant.status !== "redeemed" || !inbox.receivedAt) {
      error = "收件匣還沒有已兌現的述詞，無法送件。";
      return;
    }
    if (inbox.submittedAt) {
      error = "此申請已送出。";
      return;
    }
    const serviceRequest = s.serviceRequests.find((request) => request.id === grant.body.requestId);
    if (!serviceRequest || serviceRequest.status !== "data-delivered") {
      error = "服務需求尚未完成資料交付，無法開始處理。";
      return;
    }
    inbox.submittedAt = nowIso();
    serviceRequest.status = "processing";
    serviceRequest.processingAt = inbox.submittedAt;
    appendAudit(s, {
      actor: who.name,
      actorRole: who.role,
      action: "submit",
      grantId,
      detail: `以已交付的述詞送出「${inbox.programTitle}」申請（演示，未連真實機關）。`,
    });
  });
  return { state, error };
}
