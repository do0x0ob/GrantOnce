import { FIELD_META, GRANT_FIELDS, HOUSEHOLD_FIELDS, isFieldId, normalizeGrantId } from "./fields";
import {
  actorLabel,
  actorRole,
  audienceOfAgency,
  expiresAtFrom,
  isGrantExpired,
  parseActorId,
} from "./grant";
import { agencyOf, appendAudit, grantById, mutate, nowIso } from "./store";
import type {
  DemoState,
  FetchResult,
  FieldId,
  Grant,
  GrantCaller,
  GrantId,
  SubmitResult,
} from "./types";
import { readVaultFields } from "./vault";

const GRANT_BEARER = /^Bearer Grant (.+)$/;

export { parseActorId, audienceOfAgency, actorLabel };

export function parseGrantBearer(header: string | null): GrantId | null {
  if (!header) return null;
  const match = header.match(GRANT_BEARER);
  if (!match?.[1]) return null;
  const raw = match[1].trim();
  const recovered = Buffer.from(raw, "latin1").toString("utf8");
  return recovered || raw;
}

export function asGrantId(value: string): GrantId | null {
  return normalizeGrantId(value);
}

export function resolveGrant(state: DemoState, token: string): Grant | null {
  const trimmed = token.trim();
  const candidates = [trimmed];
  try {
    candidates.push(decodeURIComponent(trimmed));
  } catch {
    // ignore malformed percent-encoding
  }
  try {
    candidates.push(Buffer.from(trimmed, "latin1").toString("utf8"));
  } catch {
    // ignore
  }
  for (const value of candidates) {
    const byJti = state.grants.find((grant) => grant.claims?.jti === value);
    if (byJti) return byJti;
    const slot = normalizeGrantId(value);
    if (slot) {
      const bySlot = grantById(state, slot);
      if (bySlot) return bySlot;
    }
  }
  return null;
}

function inactiveMessage(grant: Grant): string {
  if (isGrantExpired(grant)) return `匣 ${grant.id} 已過期，拒絕擷取。`;
  if (grant.status === "pending") return `匣 ${grant.id} 尚未核准，拒絕擷取。`;
  if (grant.status === "revoked") return `匣 ${grant.id} 已撤銷，拒絕擷取。`;
  if (grant.status === "consumed") return `匣 ${grant.id} 已耗用，拒絕重放擷取。`;
  return `匣 ${grant.id} 不可用。`;
}

function stampAgencyDenial(state: DemoState, actorId: string | null, error: string) {
  const agencyId =
    actorId === "agency-jia" ? "jia" : actorId === "agency-yi" ? "yi" : null;
  if (!agencyId) return;
  state.agencies[agencyId].lastDenial = error;
  state.agencies[agencyId].lastDeniedAt = nowIso();
}

function callerName(caller: GrantCaller | null): string {
  if (!caller?.id) return "(missing-actor)";
  return caller.name?.trim() || actorLabel(caller.id);
}

function denyFetch(
  state: DemoState,
  caller: GrantCaller | null,
  result: Extract<FetchResult, { ok: false }>,
  grantId?: GrantId,
  deniedFields?: FieldId[],
): FetchResult {
  appendAudit(state, {
    actor: callerName(caller),
    actorRole: caller?.id ? actorRole(caller.id) : "system",
    action: "deny",
    grantId,
    detail: result.error,
    deniedFields,
  });
  stampAgencyDenial(state, caller?.id ?? null, result.error);
  return result;
}

/**
 * Authorization layer. Fail closed:
 * - unknown / missing bearer
 * - missing actor, or actor ≠ grant.audience (actors cannot self-claim)
 * - grant not active / expired
 * - any requested field outside the allowlist
 * - wildcard fields:*
 * Never returns a partial payload on overscope.
 * HTTP must pass presenter via X-GrantOnce-Presenter, not body.actor.
 */
export function fetchWithGrant(
  tokenRaw: string,
  requestedFields: string[],
  caller: GrantCaller | null,
): { state: DemoState; result: FetchResult } {
  let result: FetchResult = denial("BAD_BEARER", "缺少有效的 Bearer Grant <jti>");

  const state = mutate((s) => {
    const grantId = normalizeGrantId(grantIdRaw);
    if (!grantId) {
      result = denyFetch(s, caller, {
        ok: false,
        status: 403,
        code: "UNKNOWN_GRANT",
        error: `未知授權匣：${grantIdRaw}`,
      });
      return;
    }

    if (requestedFields.includes("*") || requestedFields.includes("fields:*")) {
      result = denyFetch(
        s,
        caller,
        {
          ok: false,
          status: 403,
          code: "WILDCARD_FORBIDDEN",
          error: "禁止 fields:* 萬用授權，請求已關閉",
        },
        grantId,
      );
      return;
    }

    const unknown = requestedFields.filter((f) => !isFieldId(f));
    const typed = requestedFields.filter(isFieldId);
    const grant = grantById(s, grantId);

    if (!grant) {
      result = denyFetch(
        s,
        caller,
        {
          ok: false,
          status: 403,
          code: "UNKNOWN_GRANT",
          error: `授權匣 ${grantId} 不存在`,
        },
        grantId,
      );
      return;
    }

    if (!caller?.id) {
      result = denyFetch(
        s,
        caller,
        {
          ok: false,
          status: 403,
          code: "MISSING_ACTOR",
          error: `匣 ${grant.id} 要求明確 actor，且必須等於 audience（${grant.audience}）。`,
        },
        grant.id,
      );
      return;
    }

    if (caller.id !== grant.audience) {
      result = denyFetch(
        s,
        caller,
        {
          ok: false,
          status: 403,
          code: "AUDIENCE_MISMATCH",
          error: `匣 ${grant.id} 的 audience 是 ${grant.audience}，呼叫端 ${caller.id} 不得使用。`,
        },
        grant.id,
      );
      return;
    }

    if (grant.status !== "active" || isGrantExpired(grant)) {
      result = denyFetch(
        s,
        caller,
        {
          ok: false,
          status: 403,
          code: "GRANT_INACTIVE",
          error: inactiveMessage(grant),
        },
        grant.id,
      );
      return;
    }

    const allow = new Set(grant.fields);
    const extra = typed.filter((f) => !allow.has(f));
    if (unknown.length || extra.length) {
      const names =
        extra.map((f) => FIELD_META[f].label).join("、") || unknown.join("、");
      result = denyFetch(
        s,
        caller,
        {
          ok: false,
          status: 403,
          code: "OVERSCOPED",
          error: `匣 ${grant.id} 未授權${names}，請求關閉。`,
          deniedFields: extra,
        },
        grant.id,
        extra,
      );
      return;
    }

    const payload = readVaultFields(typed);
    const previous = s.envelopes[grant.id] ?? emptyEnvelope(grant.id, grant.agencyId);
    s.envelopes[grant.id] = {
      grantId: grant.id,
      agencyId: grant.agencyId,
      fields: { ...previous.fields, ...payload },
      fetchedAt: nowIso(),
      receipt: null,
    };
    appendAudit(s, {
      actor: callerName(caller),
      actorRole: actorRole(caller.id),
      action: "fetch",
      grantId: grant.id,
      detail: `依匣 ${grant.id} 擷取 ${typed.length} 欄：${typed.join("、")}`,
    });
    result = { ok: true, grantId: grant.id, fieldIds: typed };
    stampProtocol(s, { token: grant.claims.jti, caller, fields: requestedFields, path: "/api/mydata/fetch", result });
  });

  return { state, result };
}

/** 甲讀乙收件匣：不回傳欄位值，audience 不合就 403。 */
export function peekEnvelope(
  tokenRaw: string,
  caller: GrantCaller | null,
): { state: DemoState; result: FetchResult } {
  let result: FetchResult = denial("BAD_BEARER", "缺少有效的匣");

  const state = mutate((s) => {
    const grant = resolveGrant(s, tokenRaw);
    if (!grant) {
      result = denyFetch(s, caller, denial("UNKNOWN_GRANT", `未知授權匣：${tokenRaw}`));
      stampProtocol(s, { token: tokenRaw, caller, fields: [], path: "/api/envelopes/peek", result });
      return;
    }

    if (!caller?.id || caller.id !== grant.claims.aud) {
      result = denyFetch(
        s,
        caller,
        denial(
          "AUDIENCE_MISMATCH",
          `收件匣 ${grant.id} 只給 ${grant.claims.aud} 讀。${caller?.id ?? "缺少 presenter"} 看不到這一匣。`,
        ),
        grant.id,
      );
      stampProtocol(s, { token: tokenRaw, caller, fields: [], path: "/api/envelopes/peek", result });
      return;
    }

    const envelope = s.envelopes[grant.id];
    const fieldIds = envelope?.receipt?.fieldIds
      ?? (Object.keys(envelope?.fields ?? {}) as FieldId[]);
    result = { ok: true, grantId: grant.id, fieldIds };
    stampProtocol(s, { token: grant.claims.jti, caller, fields: fieldIds, path: "/api/envelopes/peek", result });
  });

  return { state, result };
}

function deliverAllowlist(state: DemoState, grant: Grant) {
  const payload = readVaultFields(grant.fields);
  state.envelopes[grant.id] = {
    grantId: grant.id,
    agencyId: grant.agencyId,
    fields: payload,
    fetchedAt: nowIso(),
    receipt: null,
  };
  appendAudit(state, {
    actor: "授權層",
    actorRole: "system",
    action: "fetch",
    grantId: grant.id,
    detail: `依匣 ${grant.id} 寫入${presenterLabel(grant.claims.aud)}收件匣 ${grant.fields.length} 欄。模型看不到值。`,
  });
}

export function proposeGrantsFromPlan(
  state: DemoState,
  programs: { grantId: GrantId; title: string; agencyId: "jia" | "yi" }[],
) {
  const at = nowIso();
  const issuer = state.principal.id;
  const subject = state.principal.id;
  for (const program of programs) {
    if (grantById(state, program.grantId)) continue;
    const purpose = `僅供「${program.title}」一次申請`;
    const fields = [...GRANT_FIELDS[program.grantId]];
    const claims = buildClaims({
      iss: state.principal.id,
      aud: audienceOfAgency(program.agencyId),
      purpose,
      fields,
      nbf: at,
    });
    state.grants.push({
      id: program.grantId,
      issuer,
      subject,
      audience: audienceOfAgency(program.agencyId),
      purpose: `僅供「${program.title}」一次申請`,
      fields: [...GRANT_FIELDS[program.grantId]],
      source: "mydata",
      expiresAt: expiresAtFrom(at),
      status: "pending",
      revokeOn: "submitted",
      agencyId: program.agencyId,
      programTitle: program.title,
      proposedAt: at,
      approvedAt: null,
      revokedAt: null,
      consumedAt: null,
    });
  }
}

export function approveGrantAndFetch(grantId: GrantId): { state: DemoState; error?: string } {
  let error: string | undefined;
  let audience: string | null = null;
  mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      error = `找不到匣 ${grantId}`;
      return;
    }
    if (grant.status !== "pending" && grant.status !== "revoked") {
      error = `匣 ${grantId} 目前是 ${grant.status}，不能核准`;
      return;
    }
    const issuer = grant.issuer || s.principal.id;
    grant.status = "active";
    grant.approvedAt = nowIso();
    grant.revokedAt = null;
    audience = grant.audience;
    appendAudit(s, {
      actor: issuer,
      actorRole: "principal",
      action: "approve",
      grantId,
      detail: `核准匣 ${grantId}（${grant.programTitle}），issuer=${issuer}，audience=${grant.audience}，允許 ${grant.fields.join("、")}。所得不在此匣。`,
    });
    deliverAllowlist(s, grant);
  });
  if (error) {
    return { state: mutate(() => {}), error };
  }

  const { state } = fetchWithGrant(grantId, GRANT_FIELDS[grantId], {
    id: audience ?? "",
    name: audience ? actorLabel(audience) : undefined,
  });
  return { state };
}

export function revokeGrant(
  grantId: GrantId,
  reason: string,
  caller: GrantCaller | null,
): { state: DemoState; result: SubmitResult } {
  let result: SubmitResult = {
    ok: false,
    status: 403,
    code: "UNKNOWN_GRANT",
    error: `找不到匣 ${grantId}`,
  };
  const state = mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      result = {
        ok: false,
        status: 403,
        code: "UNKNOWN_GRANT",
        error: `找不到匣 ${grantId}`,
      };
      appendAudit(s, {
        actor: callerName(caller),
        actorRole: caller?.id ? actorRole(caller.id) : "system",
        action: "deny",
        grantId,
        detail: result.error,
      });
      return;
    }

    const callerId = caller?.id?.trim() || s.principal.id;
    if (callerId !== grant.issuer) {
      result = {
        ok: false,
        status: 403,
        code: "ISSUER_MISMATCH",
        error: `匣 ${grant.id} 的 issuer 是 ${grant.issuer}，呼叫端 ${callerId} 不得撤銷。`,
      };
      appendAudit(s, {
        actor: callerName(caller ?? { id: callerId }),
        actorRole: actorRole(callerId),
        action: "deny",
        grantId: grant.id,
        detail: result.error,
      });
      return;
    }

    if (grant.status === "consumed") {
      result = {
        ok: false,
        status: 403,
        code: "GRANT_INACTIVE",
        error: `匣 ${grantId} 已耗用，無法再撤銷`,
      };
      return;
    }
    if (grant.status === "revoked") {
      result = {
        ok: false,
        status: 403,
        code: "GRANT_INACTIVE",
        error: `匣 ${grantId} 已撤銷`,
      };
      return;
    }
    grant.status = "revoked";
    grant.revokedAt = nowIso();
    appendAudit(s, {
      actor: grant.issuer,
      actorRole: "principal",
      action: "revoke",
      grantId,
      detail: reason,
    });
    result = { ok: true, grantId };
  });
  return { state, result };
}

function denySubmit(
  state: DemoState,
  caller: GrantCaller | null,
  result: Extract<SubmitResult, { ok: false }>,
  grantId?: GrantId,
): SubmitResult {
  appendAudit(state, {
    actor: callerName(caller),
    actorRole: caller?.id ? actorRole(caller.id) : "system",
    action: "deny",
    grantId,
    detail: result.error,
  });
  stampAgencyDenial(state, caller?.id ?? null, result.error);
  return result;
}

export function submitApplication(
  grantId: GrantId,
  caller: GrantCaller | null,
): { state: DemoState; result: SubmitResult } {
  let result: SubmitResult = {
    ok: false,
    status: 403,
    code: "UNKNOWN_GRANT",
    error: `找不到匣 ${grantId}`,
  };
  const state = mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      result = denySubmit(s, caller, {
        ok: false,
        status: 403,
        code: "UNKNOWN_GRANT",
        error: `找不到匣 ${grantId}`,
      }, grantId);
      return;
    }

    if (!caller?.id) {
      result = denySubmit(s, caller, {
        ok: false,
        status: 403,
        code: "MISSING_ACTOR",
        error: `匣 ${grant.id} 送件要求明確 actor，且必須等於 audience（${grant.audience}）。`,
      }, grant.id);
      return;
    }

    if (caller.id !== grant.audience) {
      result = denySubmit(s, caller, {
        ok: false,
        status: 403,
        code: "AUDIENCE_MISMATCH",
        error: `匣 ${grant.id} 的 audience 是 ${grant.audience}，呼叫端 ${caller.id} 不得送件。`,
      }, grant.id);
      return;
    }

    if (grant.status !== "active" || isGrantExpired(grant)) {
      result = denySubmit(s, caller, {
        ok: false,
        status: 403,
        code: "GRANT_INACTIVE",
        error: `匣 ${grantId} 非有效授權，不能送件`,
      }, grant.id);
      return;
    }

    const envelope = s.envelopes[grantId];
    if (!envelope?.fetchedAt) {
      result = denySubmit(s, caller, {
        ok: false,
        status: 403,
        code: "NO_ENVELOPE",
        error: "收件匣還沒有資料，無法送件",
      }, grant.id);
      return;
    }

    grant.status = "consumed";
    grant.consumedAt = submittedAt;
    grant.revokedAt = submittedAt;
    const agencyId = agencyOf(grantId);
    s.agencies[agencyId].submittedAt = submittedAt;
    s.envelopes[grantId] = {
      grantId: grant.id,
      agencyId: grant.agencyId,
      fields: {},
      fetchedAt: envelope.fetchedAt,
      receipt,
    };
    appendAudit(s, {
      actor: callerName(caller),
      actorRole: actorRole(caller.id),
      action: "submit",
      grantId,
      detail: `送出「${grant.programTitle}」申請（演示，未連真實機關）`,
    });
    appendAudit(s, {
      actor: "系統",
      actorRole: "system",
      action: "receipt",
      grantId,
      detail: `收件匣改為收據 ${receipt.fieldIds.length} 欄 sha256:${receipt.hash.slice(0, 12)}… 明文已刪。`,
    });
    appendAudit(s, {
      actor: "系統",
      actorRole: "system",
      action: "revoke",
      grantId,
      detail: `送件完成，匣 ${grantId} 立即耗用並撤銷。重放擷取將失敗。`,
    });
    result = { ok: true, grantId };
  });
  return { state, result };
}

export function householdOverscopeFields(): FieldId[] {
  return [...HOUSEHOLD_FIELDS];
}
