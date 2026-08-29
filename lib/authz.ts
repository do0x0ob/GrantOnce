import { FIELD_META, GRANT_FIELDS, HOUSEHOLD_FIELDS, isFieldId, normalizeGrantId } from "./fields";
import {
  actorLabel,
  actorRole,
  audienceOfAgency,
  buildReceipt,
  emptyEnvelope,
  expiresAtFrom,
  isGrantExpired,
  newTicketJti,
  parseTicketRef,
  parseTicketToken,
  signTicket,
  verifyTicketMac,
} from "./grant";
import { agencyOf, appendAudit, grantById, mutate, nowIso } from "./store";
import type {
  AuthzDenialCode,
  DemoState,
  FetchResult,
  FieldId,
  Grant,
  GrantCaller,
  GrantId,
  ProtocolEvent,
  StoredTicket,
  SubmitResult,
  TicketClaims,
} from "./types";
import { readVaultFields } from "./vault";

const GRANT_BEARER = /^Bearer Grant (.+)$/;

export { audienceOfAgency, actorLabel };

export function parseGrantBearer(header: string | null): string | null {
  if (!header) return null;
  const match = GRANT_BEARER.exec(header);
  if (!match?.[1]) return null;
  return match[1].trim();
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

function stampAgencyDenial(state: DemoState, audience: string | null, error: string) {
  const agencyId =
    audience === "agency-jia" ? "jia" : audience === "agency-yi" ? "yi" : null;
  if (!agencyId) return;
  state.agencies[agencyId].lastDenial = error;
  state.agencies[agencyId].lastDeniedAt = nowIso();
}

function denial(
  code: AuthzDenialCode,
  error: string,
  deniedFields?: FieldId[],
): Extract<FetchResult, { ok: false }> {
  return { ok: false, status: 403, code, error, deniedFields };
}

function stampProtocol(
  state: DemoState,
  input: {
    token: string;
    fields: string[];
    path: ProtocolEvent["request"]["path"];
    result: FetchResult | SubmitResult;
  },
) {
  const ref = parseTicketRef(input.token);
  const shown = ref?.jti ?? input.token;
  state.lastProtocol = {
    at: nowIso(),
    request: {
      authorization: `Bearer Grant ${shown}`,
      fields: input.fields,
      path: input.path,
    },
    response: input.result.ok
      ? {
          ok: true,
          status: 200,
          fieldIds: "fieldIds" in input.result ? input.result.fieldIds : undefined,
        }
      : {
          ok: false,
          status: input.result.status,
          code: input.result.code,
          error: input.result.error,
        },
  };
}

function lookupTicket(
  state: DemoState,
  raw: string,
): { ok: true; stored: StoredTicket } | { ok: false; result: Extract<FetchResult, { ok: false }> } {
  const parsed = parseTicketRef(raw);
  if (!parsed) {
    return {
      ok: false,
      result: denial(
        "BAD_TICKET",
        "需要有效的 HMAC ticket（ticket id 或 Bearer grn_…）。匣號本身不是能力憑證。",
      ),
    };
  }
  const stored = state.tickets?.[parsed.jti];
  if (!stored) {
    return {
      ok: false,
      result: denial("BAD_TICKET", `未知 ticket：${parsed.jti}`),
    };
  }
  const claims: TicketClaims = {
    jti: stored.jti,
    grantId: stored.grantId,
    iss: stored.iss,
    aud: stored.aud,
    fields: stored.fields,
    exp: stored.exp,
  };
  const mac = parsed.mac ?? parseTicketToken(stored.token)?.mac;
  if (!mac || !verifyTicketMac(claims, mac)) {
    return {
      ok: false,
      result: denial("BAD_TICKET", "ticket HMAC 驗證失敗，請求關閉。"),
    };
  }
  if (Date.parse(stored.exp) <= Date.now()) {
    return {
      ok: false,
      result: denial("GRANT_INACTIVE", `ticket ${stored.jti} 已過期。`),
    };
  }
  return { ok: true, stored };
}

/**
 * Authorization layer. Fail closed.
 * Fetch/submit take an HMAC ticket — never a self-asserted actor.
 */
export function fetchWithGrant(
  ticketRaw: string,
  requestedFields: string[],
): { state: DemoState; result: FetchResult } {
  let result: FetchResult = denial("BAD_TICKET", "缺少有效的 HMAC ticket");

  const state = mutate((s) => {
    if (requestedFields.includes("*") || requestedFields.includes("fields:*")) {
      result = denial("WILDCARD_FORBIDDEN", "禁止 fields:* 萬用授權，請求已關閉");
      const looked = lookupTicket(s, ticketRaw);
      appendAudit(s, {
        actor: looked.ok ? actorLabel(looked.stored.aud) : "未知",
        actorRole: looked.ok ? actorRole(looked.stored.aud) : "system",
        action: "deny",
        grantId: looked.ok ? looked.stored.grantId : null,
        detail: result.error,
      });
      if (looked.ok) stampAgencyDenial(s, looked.stored.aud, result.error);
      stampProtocol(s, { token: ticketRaw, fields: requestedFields, path: "/api/mydata/fetch", result });
      return;
    }

    const looked = lookupTicket(s, ticketRaw);
    if (!looked.ok) {
      result = looked.result;
      appendAudit(s, {
        actor: "未知",
        actorRole: "system",
        action: "deny",
        detail: result.error,
      });
      stampProtocol(s, { token: ticketRaw, fields: requestedFields, path: "/api/mydata/fetch", result });
      return;
    }

    const { stored } = looked;
    const grant = grantById(s, stored.grantId);
    if (!grant) {
      result = denial("UNKNOWN_GRANT", `授權匣 ${stored.grantId} 不存在`);
      appendAudit(s, {
        actor: actorLabel(stored.aud),
        actorRole: actorRole(stored.aud),
        action: "deny",
        grantId: stored.grantId,
        detail: result.error,
      });
      stampProtocol(s, { token: ticketRaw, fields: requestedFields, path: "/api/mydata/fetch", result });
      return;
    }

    if (grant.status !== "active" || isGrantExpired(grant)) {
      result = denial("GRANT_INACTIVE", inactiveMessage(grant));
      appendAudit(s, {
        actor: actorLabel(stored.aud),
        actorRole: actorRole(stored.aud),
        action: "deny",
        grantId: grant.id,
        detail: result.error,
      });
      stampAgencyDenial(s, stored.aud, result.error);
      stampProtocol(s, { token: stored.token, fields: requestedFields, path: "/api/mydata/fetch", result });
      return;
    }

    if (stored.aud !== grant.audience || stored.iss !== grant.issuer) {
      result = denial(
        "AUDIENCE_MISMATCH",
        `ticket 綁定 iss=${stored.iss} aud=${stored.aud}，與匣 ${grant.id} 不符。`,
      );
      appendAudit(s, {
        actor: actorLabel(stored.aud),
        actorRole: actorRole(stored.aud),
        action: "deny",
        grantId: grant.id,
        detail: result.error,
      });
      stampAgencyDenial(s, stored.aud, result.error);
      stampProtocol(s, { token: stored.token, fields: requestedFields, path: "/api/mydata/fetch", result });
      return;
    }

    const unknown = requestedFields.filter((f) => !isFieldId(f));
    const typed = requestedFields.filter(isFieldId);
    const allow = new Set(stored.fields);
    const extra = typed.filter((f) => !allow.has(f));
    if (unknown.length || extra.length) {
      const names =
        extra.map((f) => FIELD_META[f].label).join("、") || unknown.join("、");
      result = denial("OVERSCOPED", `匣 ${grant.id} 未授權${names}，請求關閉。`, extra);
      appendAudit(s, {
        actor: actorLabel(stored.aud),
        actorRole: actorRole(stored.aud),
        action: "deny",
        grantId: grant.id,
        detail: result.error,
        deniedFields: extra,
      });
      stampAgencyDenial(s, stored.aud, result.error);
      stampProtocol(s, { token: stored.token, fields: requestedFields, path: "/api/mydata/fetch", result });
      return;
    }

    const payload = readVaultFields(typed);
    const previous = s.envelopes[grant.id] ?? emptyEnvelope(grant.id, grant.agencyId);
    s.envelopes[grant.id] = {
      grantId: grant.id,
      agencyId: grant.agencyId,
      fields: { ...previous.fields, ...payload },
      fetchedAt: nowIso(),
      receipt: previous.receipt,
    };
    appendAudit(s, {
      actor: actorLabel(stored.aud),
      actorRole: actorRole(stored.aud),
      action: "fetch",
      grantId: grant.id,
      detail: `依 ticket ${stored.jti} 擷取 ${typed.length} 欄：${typed.join("、")}`,
    });
    result = { ok: true, grantId: grant.id, fieldIds: typed };
    stampProtocol(s, { token: stored.token, fields: requestedFields, path: "/api/mydata/fetch", result });
  });

  return { state, result };
}

function issueTicket(state: DemoState, grant: Grant): StoredTicket {
  const claims: TicketClaims = {
    jti: newTicketJti(),
    grantId: grant.id,
    iss: grant.issuer,
    aud: grant.audience,
    fields: [...grant.fields],
    exp: grant.expiresAt,
  };
  const token = signTicket(claims);
  const stored: StoredTicket = { ...claims, token };
  if (!state.tickets) state.tickets = {};
  state.tickets[claims.jti] = stored;
  grant.ticketId = claims.jti;
  grant.ticket = token;
  return stored;
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
    detail: `依匣 ${grant.id} 寫入${actorLabel(grant.audience)}收件匣 ${grant.fields.length} 欄。模型看不到值。`,
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
      ticketId: null,
      ticket: null,
    });
  }
}

export function approveGrantAndFetch(
  grantId: GrantId,
): { state: DemoState; error?: string; ticket?: string } {
  let error: string | undefined;
  let ticket: string | undefined;
  const state = mutate((s) => {
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
    const stored = issueTicket(s, grant);
    ticket = stored.token;
    appendAudit(s, {
      actor: issuer,
      actorRole: "principal",
      action: "approve",
      grantId,
      detail: `核准匣 ${grantId}（${grant.programTitle}），issuer=${issuer}，audience=${grant.audience}，發出 ticket ${stored.jti}。所得不在此匣。`,
    });
    deliverAllowlist(s, grant);
  });
  return { state, error, ticket };
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
        actor: caller?.id ?? "未知",
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
        actor: callerId,
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
    grant.ticket = null;
    if (grant.ticketId && s.tickets) delete s.tickets[grant.ticketId];
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

export function submitApplication(ticketRaw: string): { state: DemoState; result: SubmitResult } {
  let result: SubmitResult = {
    ok: false,
    status: 403,
    code: "BAD_TICKET",
    error: "送件需要 HMAC ticket",
  };
  const state = mutate((s) => {
    const looked = lookupTicket(s, ticketRaw);
    if (!looked.ok) {
      result = looked.result;
      appendAudit(s, {
        actor: "未知",
        actorRole: "system",
        action: "deny",
        detail: result.error,
      });
      stampProtocol(s, { token: ticketRaw, fields: [], path: "/api/applications/submit", result });
      return;
    }

    const { stored } = looked;
    const grant = grantById(s, stored.grantId);
    if (!grant) {
      result = {
        ok: false,
        status: 403,
        code: "UNKNOWN_GRANT",
        error: `找不到匣 ${stored.grantId}`,
      };
      stampProtocol(s, { token: ticketRaw, fields: [], path: "/api/applications/submit", result });
      return;
    }

    if (grant.status !== "active" || isGrantExpired(grant)) {
      result = {
        ok: false,
        status: 403,
        code: "GRANT_INACTIVE",
        error: `匣 ${grant.id} 非有效授權，不能送件`,
      };
      appendAudit(s, {
        actor: actorLabel(stored.aud),
        actorRole: actorRole(stored.aud),
        action: "deny",
        grantId: grant.id,
        detail: result.error,
      });
      stampAgencyDenial(s, stored.aud, result.error);
      stampProtocol(s, { token: stored.token, fields: [], path: "/api/applications/submit", result });
      return;
    }

    const envelope = s.envelopes[grant.id];
    if (!envelope?.fetchedAt || Object.keys(envelope.fields).length === 0) {
      result = {
        ok: false,
        status: 403,
        code: "NO_ENVELOPE",
        error: "收件匣還沒有資料，無法送件",
      };
      appendAudit(s, {
        actor: actorLabel(stored.aud),
        actorRole: actorRole(stored.aud),
        action: "deny",
        grantId: grant.id,
        detail: result.error,
      });
      stampProtocol(s, { token: stored.token, fields: [], path: "/api/applications/submit", result });
      return;
    }

    const submittedAt = nowIso();
    const receipt = buildReceipt(stored.jti, envelope.fields, submittedAt);
    grant.status = "consumed";
    grant.consumedAt = submittedAt;
    grant.revokedAt = submittedAt;
    grant.ticket = null;
    const agencyId = agencyOf(grant.id);
    s.agencies[agencyId].submittedAt = submittedAt;
    s.envelopes[grant.id] = {
      grantId: grant.id,
      agencyId: grant.agencyId,
      fields: {},
      fetchedAt: envelope.fetchedAt,
      receipt,
    };
    if (s.tickets) delete s.tickets[stored.jti];
    appendAudit(s, {
      actor: actorLabel(stored.aud),
      actorRole: actorRole(stored.aud),
      action: "submit",
      grantId: grant.id,
      detail: `送出「${grant.programTitle}」申請（演示，未連真實機關）`,
    });
    appendAudit(s, {
      actor: "系統",
      actorRole: "system",
      action: "receipt",
      grantId: grant.id,
      detail: `收件匣改為收據 ${receipt.fieldIds.length} 欄 sha256:${receipt.hash.slice(0, 12)}… 明文已刪。`,
    });
    appendAudit(s, {
      actor: "系統",
      actorRole: "system",
      action: "revoke",
      grantId: grant.id,
      detail: `送件完成，匣 ${grant.id} 立即耗用並撤銷。重放擷取將失敗。`,
    });
    result = { ok: true, grantId: grant.id };
    stampProtocol(s, { token: stored.token, fields: receipt.fieldIds, path: "/api/applications/submit", result });
  });
  return { state, result };
}

export function householdOverscopeFields(): FieldId[] {
  return [...HOUSEHOLD_FIELDS];
}

export function ticketFor(state: DemoState, grantId: GrantId): string | null {
  return grantById(state, grantId)?.ticket ?? null;
}
