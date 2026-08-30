import { CLAIM_DEFS, isClaimId, type ClaimId } from "./claims";
import { digest, randomId, serializeBody, sign, thumbprint, unb64u, verify } from "./crypto";
import { normalizeGrantId } from "./fields";
import { AGENCY_KEYS, AGENCY_NAMES, isKnownAgency } from "./parties";
import { claimsOutsidePurpose, PURPOSES, type PurposeId } from "./purposes";
import { purposesFrom } from "./registry";
import { assessRisk } from "./risk";
import { appendAudit, agencyOf, getState, grantById, mutate, notify, nowIso } from "./store";
import type {
  AgencyId,
  DemoState,
  Grant,
  GrantBody,
  GrantId,
  ProgramPlan,
  RedeemProof,
  RedeemResult,
} from "./types";
import { GRANT_STATUS_LABEL } from "./view";
import { ensureCredentials, findValidCredential, verifyCredential } from "./wallet";

function actorFor(agency: AgencyId): { name: string; role: "agency-jia" | "agency-yi" } {
  return {
    name: AGENCY_NAMES[agency],
    role: agency === "jia" ? "agency-jia" : "agency-yi",
  };
}

function stampDenial(state: DemoState, agency: AgencyId | null, error: string) {
  if (!agency) return;
  state.inboxes[agency].lastDenial = error;
  state.inboxes[agency].lastDeniedAt = nowIso();
}

/** The consent wording, signed alongside everything else so the record proves
 *  what was displayed, not merely that the principal tapped. */
function purposeOn(state: DemoState, purpose: PurposeId) {
  return purposesFrom(state)[purpose];
}

export function buildDisplayText(
  purpose: PurposeId,
  claims: ClaimId[],
  expIso: string,
  def = PURPOSES[purpose],
): string {
  const lines = [
    `${def.agencyName} 將取得以下關於你的資訊，用於「${def.title}」：`,
    ...claims.map((c) => `• ${CLAIM_DEFS[c].label}（${CLAIM_DEFS[c].shape}）`),
    "",
    def.necessity,
    "",
    `法定依據：${def.legalBasis.join("；")}`,
    `有效至 ${new Date(expIso).toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" })}，僅能使用一次，且只有「${def.agencyName}」能兌現。`,
  ];
  return lines.join("\n");
}

function buildGrant(
  state: DemoState,
  input: { grantId: GrantId; purpose: PurposeId; claims: ClaimId[] },
  now: Date,
): Grant {
  const def = purposeOn(state, input.purpose);
  if (!def) {
    throw new Error(`目的「${input.purpose}」未掛在登記台，不能建匣。`);
  }
  const ttl = Math.min(state.delegation.grantTtlSeconds, def.maxTtlSeconds);
  const exp = new Date(now.getTime() + ttl * 1000).toISOString();
  const displayText = buildDisplayText(input.purpose, input.claims, exp, def);

  const body: GrantBody = {
    aud: def.agency,
    claims: input.claims,
    cnf: { jkt: AGENCY_KEYS[def.agency].jkt },
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

export function proposeGrantsFromPlan(state: DemoState, programs: ProgramPlan[]) {
  const now = new Date();
  for (const program of programs) {
    const fresh = buildGrant(
      state,
      { grantId: program.grantId, purpose: program.purpose, claims: program.claims },
      now,
    );
    const idx = state.grants.findIndex((g) => g.id === program.grantId);
    // A proposal always replaces a stale one: a new jti, a new expiry, a new
    // signature. Grants are never reactivated in place.
    if (idx >= 0) state.grants[idx] = fresh;
    else state.grants.push(fresh);

    if (fresh.risk === "blocked") {
      appendAudit(state, {
        actor: "目的登記表",
        actorRole: "system",
        action: "deny",
        grantId: fresh.id,
        detail: `提案即攔截：${fresh.riskNotes.join(" ")}`,
        risk: "blocked",
      });
    }
  }
}

/**
 * An agency asking for something on its own initiative. Runs the full risk
 * engine at proposal time, so an over-broad request is refused before the
 * principal is ever shown a button to approve it.
 */
export function requestClaims(
  agency: AgencyId,
  purpose: PurposeId,
  claims: string[],
): { state: DemoState; blocked: boolean; notes: string[] } {
  let blocked = false;
  let notes: string[] = [];
  const now = new Date();

  const state = mutate((s) => {
    const risk = assessRisk({
      purpose,
      claims,
      delegation: s.delegation,
      recentAudit: s.audit,
      now,
    });
    notes = risk.notes;
    blocked = risk.level === "blocked";

    // The requester must be the agency the purpose belongs to. Without this,
    // 乙 could ask for childcare claims and be told the request is fine.
    if (!Object.hasOwn(PURPOSES, purpose)) {
      const live = purposeOn(s, purpose);
      if (!live || live.agency !== agency) {
        notes = [
          `「${live?.title ?? purpose}」不屬於 ${AGENCY_NAMES[agency]} 的法定職務。`,
          ...notes,
        ];
        blocked = true;
      }
    } else
    if (PURPOSES[purpose].agency !== agency) {
      notes = [
        `「${PURPOSES[purpose].title}」是 ${AGENCY_NAMES[PURPOSES[purpose].agency]} 的法定職務，${AGENCY_NAMES[agency]} 不能以此目的索取資料。`,
        ...notes,
      ];
      blocked = true;
    }

    const actor = actorFor(agency);
    if (blocked) {
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        grantId: null,
        detail: `逾越請求遭攔截：${risk.notes.join(" ")}`,
        deniedClaims: risk.blockedClaims,
        risk: "blocked",
      });
      stampDenial(s, agency, risk.notes.join(" ") || "請求遭攔截。");
      notify(s, {
        kind: "risk",
        title: `攔截了 ${AGENCY_NAMES[agency]} 的逾越請求`,
        body: risk.notes.join("\n"),
        grantId: null,
      });
    }
  });

  return { state, blocked, notes };
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

    appendAudit(s, {
      actor: s.principal.name,
      actorRole: "principal",
      action: "sign",
      grantId: grant.id,
      detail: `以${grant.signMethod === "passkey" ? " passkey 生物辨識" : "軟體金鑰"}簽署匣 ${grant.id}（${(purposeOn(s, grant.body.purpose) ?? PURPOSES[grant.body.purpose])?.title ?? grant.body.purpose}）。簽章涵蓋 aud／cnf／jti／exp／述詞／同意畫面文字，摘要 ${grant.digest.slice(0, 12)}。`,
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
      stampDenial(s, claimer, error);
    };

    const grantId = normalizeGrantId(grantIdRaw);
    if (!grantId) return fail("UNKNOWN_GRANT", `未知的匣：${grantIdRaw}。`);

    const grant = grantById(s, grantId);
    if (!grant) return fail("UNKNOWN_GRANT", `匣 ${grantId} 不存在。`);

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

    const risk = assessRisk({
      purpose: grant.body.purpose,
      claims: grant.body.claims,
      delegation: s.delegation,
      recentAudit: s.audit,
      now,
    });
    if (risk.level === "blocked") {
      return fail("RISK_BLOCKED", risk.notes.join(" "), {
        deniedClaims: risk.blockedClaims,
      });
    }

    // --- present credentials -------------------------------------------------
    const claims = grant.body.claims.filter(isClaimId);
    // Verify what the wallet already holds *before* issuing anything. Issuing
    // first and validating afterwards left new credentials — and a vault read —
    // behind on a failed redemption, with no issuance recorded in the audit.
    const staleCredential = claims
      .map((claimId) => findValidCredential(s, claimId, claimer, now))
      .find((cred) => cred && !verifyCredential(cred));
    if (staleCredential) {
      return fail("MISSING_CREDENTIAL", `憑證「${staleCredential.label}」的發證機構簽章無效。`);
    }

    const { issued, reused, credentials } = ensureCredentials(s, claims, claimer, now);
    const bad = credentials.find((c) => !verifyCredential(c));
    if (bad) {
      return fail("MISSING_CREDENTIAL", `憑證「${bad.label}」的發證機構簽章無效。`);
    }
    if (credentials.length !== claims.length) {
      return fail("MISSING_CREDENTIAL", "皮夾缺少本匣所需的憑證。");
    }

    for (const cred of credentials) cred.presentedCount += 1;

    s.inboxes[claimer] = {
      ...s.inboxes[claimer],
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
      detail: `雙鑰匙通過（委託人簽章 ✓ 機關持有證明 ✓ 法定目的 ✓），交付 ${claims.length} 項述詞至「${purposeDef.title}」收件匣${reused.length ? `；其中 ${reused.length} 項沿用皮夾既有憑證，未再調閱` : ""}。匣 ${grant.id} 就此耗用。`,
      risk: risk.level,
    });

    result = { ok: true, grantId: grant.id, claimIds: claims, deliveredTo: claimer };
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

/** The revocation that always works: stop the agent signing anything new. */
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
    const agency = agencyOf(grantId);
    const who = actorFor(agency);
    const inbox = s.inboxes[agency];
    if (grant.status !== "redeemed" || !inbox.receivedAt) {
      error = "收件匣還沒有已兌現的述詞，無法送件。";
      return;
    }
    if (inbox.submittedAt) {
      error = "此申請已送出。";
      return;
    }
    inbox.submittedAt = nowIso();
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
