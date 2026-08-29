import { GRANT_FIELDS, HOUSEHOLD_FIELDS, isFieldId } from "./fields";
import { agencyOf, appendAudit, grantById, mutate, nowIso } from "./store";
import type { DemoState, FetchResult, FieldId, Grant, GrantId } from "./types";
import { readVaultFields } from "./vault";

const GRANT_BEARER = /^Bearer Grant (.+)$/;

export function parseGrantBearer(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(GRANT_BEARER);
  return match?.[1]?.trim() ?? null;
}

export function isGrantId(value: string): value is GrantId {
  return value === "G-甲" || value === "G-乙";
}

function inactiveMessage(grant: Grant): string {
  if (grant.status === "proposed") return `匣 ${grant.id} 尚未核准，拒絕擷取`;
  if (grant.status === "revoked") return `匣 ${grant.id} 已撤銷，拒絕擷取`;
  if (grant.status === "consumed") return `匣 ${grant.id} 已隨送件耗用，拒絕重放擷取`;
  return `匣 ${grant.id} 不可用`;
}

function stampAgencyDenial(
  state: DemoState,
  role: "agent" | "agency-jia" | "agency-yi",
  error: string,
) {
  const agencyId = role === "agency-jia" ? "jia" : role === "agency-yi" ? "yi" : null;
  if (!agencyId) return;
  state.agencies[agencyId].lastDenial = error;
  state.agencies[agencyId].lastDeniedAt = nowIso();
}

/**
 * Authorization layer. Fail closed:
 * - unknown / missing bearer
 * - grant not active
 * - any requested field outside the allowlist
 * - wildcard fields:*
 * Never returns a partial payload on overscope.
 */
export function fetchWithGrant(
  grantIdRaw: string,
  requestedFields: string[],
  actor: { name: string; role: "agent" | "agency-jia" | "agency-yi" },
): { state: DemoState; result: FetchResult } {
  let result: FetchResult = {
    ok: false,
    status: 403,
    code: "BAD_BEARER",
    error: "缺少有效的 Bearer Grant <id>",
  };

  const state = mutate((s) => {
    if (!isGrantId(grantIdRaw)) {
      result = {
        ok: false,
        status: 403,
        code: "UNKNOWN_GRANT",
        error: `未知授權匣：${grantIdRaw}`,
      };
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        detail: result.error,
      });
      stampAgencyDenial(s, actor.role, result.error);
      return;
    }

    if (requestedFields.includes("*") || requestedFields.includes("fields:*")) {
      result = {
        ok: false,
        status: 403,
        code: "WILDCARD_FORBIDDEN",
        error: "禁止 fields:* 萬用授權，請求已關閉",
      };
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        grantId: grantIdRaw,
        detail: result.error,
      });
      stampAgencyDenial(s, actor.role, result.error);
      return;
    }

    const unknown = requestedFields.filter((f) => !isFieldId(f));
    const typed = requestedFields.filter(isFieldId);
    const grant = grantById(s, grantIdRaw);

    if (!grant) {
      result = {
        ok: false,
        status: 403,
        code: "UNKNOWN_GRANT",
        error: `授權匣 ${grantIdRaw} 不存在`,
      };
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        grantId: grantIdRaw,
        detail: result.error,
      });
      stampAgencyDenial(s, actor.role, result.error);
      return;
    }

    if (grant.status !== "active") {
      result = {
        ok: false,
        status: 403,
        code: "GRANT_INACTIVE",
        error: inactiveMessage(grant),
      };
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        grantId: grant.id,
        detail: result.error,
      });
      stampAgencyDenial(s, actor.role, result.error);
      return;
    }

    const allow = new Set(grant.fields);
    const extra = typed.filter((f) => !allow.has(f));
    if (unknown.length || extra.length) {
      result = {
        ok: false,
        status: 403,
        code: "OVERSCOPED",
        error: `越權關閉：匣 ${grant.id} 未授權 ${[...extra, ...unknown].join("、")}`,
        deniedFields: extra,
      };
      appendAudit(s, {
        actor: actor.name,
        actorRole: actor.role,
        action: "deny",
        grantId: grant.id,
        detail: result.error,
        deniedFields: extra,
      });
      stampAgencyDenial(s, actor.role, result.error);
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
      actor: actor.name,
      actorRole: actor.role,
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
) {
  const at = nowIso();
  for (const program of programs) {
    if (grantById(state, program.grantId)) continue;
    state.grants.push({
      id: program.grantId,
      agencyId: program.agencyId,
      purpose: `僅供「${program.title}」一次申請`,
      programTitle: program.title,
      fields: [...GRANT_FIELDS[program.grantId]],
      status: "proposed",
      proposedAt: at,
      approvedAt: null,
      revokedAt: null,
      consumedAt: null,
    });
  }
}

export function approveGrantAndFetch(grantId: GrantId): { state: DemoState; error?: string } {
  let error: string | undefined;
  mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      error = `找不到匣 ${grantId}`;
      return;
    }
    if (grant.status !== "proposed" && grant.status !== "revoked") {
      error = `匣 ${grantId} 目前是 ${grant.status}，不能核准`;
      return;
    }
    grant.status = "active";
    grant.approvedAt = nowIso();
    grant.revokedAt = null;
    appendAudit(s, {
      actor: "林曉晴",
      actorRole: "principal",
      action: "approve",
      grantId,
      detail: `核准匣 ${grantId}（${grant.programTitle}），允許 ${grant.fields.join("、")}。所得不在此匣。`,
    });
  });
  if (error) {
    return { state: mutate(() => {}), error };
  }

  const { state } = fetchWithGrant(grantId, GRANT_FIELDS[grantId], {
    name: "補助代理人",
    role: "agent",
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
      actor: "林曉晴",
      actorRole: "principal",
      action: "revoke",
      grantId,
      detail: reason,
    });
  });
  return { state, error };
}

export function submitApplication(grantId: GrantId): { state: DemoState; error?: string } {
  let error: string | undefined;
  const state = mutate((s) => {
    const grant = grantById(s, grantId);
    if (!grant) {
      error = `找不到匣 ${grantId}`;
      return;
    }
    if (grant.status !== "active") {
      error = `匣 ${grantId} 非有效授權，不能送件`;
      return;
    }
    const envelope = s.envelopes[grantId];
    if (!envelope?.fetchedAt) {
      error = "收件匣還沒有資料，無法送件";
      return;
    }
    grant.status = "consumed";
    grant.consumedAt = nowIso();
    grant.revokedAt = nowIso();
    const agencyId = agencyOf(grantId);
    s.agencies[agencyId].submittedAt = nowIso();
    appendAudit(s, {
      actor: s.agencies[agencyId].name,
      actorRole: agencyId === "jia" ? "agency-jia" : "agency-yi",
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
  });
  return { state, error };
}

export function householdOverscopeFields(): FieldId[] {
  return [...HOUSEHOLD_FIELDS];
}
