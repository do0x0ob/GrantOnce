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
  return normalizeGrantId(raw) ?? normalizeGrantId(recovered);
}

export function asGrantId(value: string): GrantId | null {
  return normalizeGrantId(value);
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
 */
export function fetchWithGrant(
  grantIdRaw: string,
  requestedFields: string[],
  caller: GrantCaller | null,
): { state: DemoState; result: FetchResult } {
  let result: FetchResult = {
    ok: false,
    status: 403,
    code: "BAD_BEARER",
    error: "缺少有效的 Bearer Grant <id>",
  };

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
    s.envelopes[grant.id] = {
      grantId: grant.id,
      agencyId: grant.agencyId,
      fields: { ...s.envelopes[grant.id]?.fields, ...payload },
      fetchedAt: nowIso(),
    };
    appendAudit(s, {
      actor: callerName(caller),
      actorRole: actorRole(caller.id),
      action: "fetch",
      grantId: grant.id,
      detail: `依匣 ${grant.id} 擷取 ${typed.length} 欄：${typed.join("、")}`,
    });
    result = { ok: true, grantId: grant.id, fields: payload };
  });

  return { state, result };
}

export function proposeGrantsFromPlan(
  state: DemoState,
  programs: { grantId: GrantId; title: string; agencyId: "jia" | "yi" }[],
  options?: { issuer?: string; subject?: string },
) {
  const at = nowIso();
  const issuer = options?.issuer?.trim() || state.principal.id;
  const subject = options?.subject?.trim() || state.principal.id;
  for (const program of programs) {
    if (grantById(state, program.grantId)) continue;
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

export function approveGrantAndFetch(
  grantId: GrantId,
  options?: { issuer?: string },
): { state: DemoState; error?: string } {
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
    const issuer = options?.issuer?.trim() || grant.issuer || s.principal.id;
    grant.issuer = issuer;
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

export function revokeGrant(grantId: GrantId, reason: string): { state: DemoState; error?: string } {
  let error: string | undefined;
  const state = mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      error = `找不到匣 ${grantId}`;
      return;
    }
    if (grant.status === "consumed") {
      error = `匣 ${grantId} 已耗用，無法再撤銷`;
      return;
    }
    if (grant.status === "revoked") {
      error = `匣 ${grantId} 已撤銷`;
      return;
    }
    grant.status = "revoked";
    grant.revokedAt = nowIso();
    appendAudit(s, {
      actor: grant.issuer || s.principal.id,
      actorRole: "principal",
      action: "revoke",
      grantId,
      detail: reason,
    });
  });
  return { state, error };
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
    grant.consumedAt = nowIso();
    grant.revokedAt = nowIso();
    const agencyId = agencyOf(grantId);
    s.agencies[agencyId].submittedAt = nowIso();
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
