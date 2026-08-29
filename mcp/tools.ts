import {
  approveGrantAndFetch,
  asGrantId,
  fetchWithGrant,
  householdOverscopeFields,
  proposeGrantsFromPlan,
  revokeGrant,
  submitApplication,
} from "../lib/authz";
import { FIELD_META } from "../lib/fields";
import {
  ageHint,
  HAPPY_PATH_UTTERANCE,
  matchPrograms,
  situationFromUtterance,
} from "../lib/rules";
import { appendChat, getState, mutate } from "../lib/store";
import type { FieldId, GrantId } from "../lib/types";
import { VAULT } from "../lib/vault";
import { agentSight, incomeNeverGranted } from "../lib/view";

export const TOOL_NAMES = [
  "plan_applications",
  "approve_grant",
  "fetch_field",
  "submit_application",
  "revoke_grant",
  "get_audit",
] as const;

export type ActorRole = "agent" | "agency-jia" | "agency-yi";

const ACTORS: Record<ActorRole, { name: string; role: ActorRole }> = {
  agent: { name: "補助代理人", role: "agent" },
  "agency-jia": { name: "甲｜新北市社會局", role: "agency-jia" },
  "agency-yi": { name: "乙｜經濟部能源署 × 台電", role: "agency-yi" },
};

/** Distinctive vault values the model must never receive. */
export const VAULT_VALUE_MARKERS = Object.values(VAULT.records).filter(
  (value) => value.length >= 4 && value !== "母親" && value !== "2025",
);

export function vaultLeakIn(payload: unknown): string | null {
  const blob = JSON.stringify(payload);
  for (const value of VAULT_VALUE_MARKERS) {
    if (blob.includes(value)) return value;
  }
  if (blob.includes("vaultHoldings") || blob.includes('"records"')) {
    return "vault object";
  }
  return null;
}

export function assertNoVaultLeak(payload: unknown, where: string) {
  const leak = vaultLeakIn(payload);
  if (leak) {
    throw new Error(`${where} leaked vault to the model: ${leak}`);
  }
}

function fieldLabels(ids: string[]): string[] {
  return ids.map((id) => (id in FIELD_META ? FIELD_META[id as FieldId].label : id));
}

function requireGrantId(raw: string): GrantId {
  const grantId = asGrantId(raw);
  if (!grantId) {
    throw new Error(`無效的匣編號：${raw}（可用 G-甲 / G-jia、G-乙 / G-yi）`);
  }
  return grantId;
}

function normalizeActor(raw?: string): { name: string; role: ActorRole } {
  const t = (raw ?? "agent").trim().toLowerCase();
  if (t === "agency-yi" || t === "yi" || t === "乙" || t === "agency-b") {
    return ACTORS["agency-yi"];
  }
  if (t === "agency-jia" || t === "jia" || t === "甲" || t === "agency-a") {
    return ACTORS["agency-jia"];
  }
  return ACTORS.agent;
}

function grantPublic(grantId: GrantId) {
  const grant = getState().grants.find((g) => g.id === grantId);
  if (!grant) return null;
  return {
    id: grant.id,
    agencyId: grant.agencyId,
    purpose: grant.purpose,
    programTitle: grant.programTitle,
    fields: grant.fields,
    fieldLabels: fieldLabels(grant.fields),
    status: grant.status,
    approvedAt: grant.approvedAt,
    consumedAt: grant.consumedAt,
    revokedAt: grant.revokedAt,
  };
}

export function planApplications(utterance: string) {
  const message = utterance.trim() || HAPPY_PATH_UTTERANCE;
  const situation = situationFromUtterance(message);

  if (!situation) {
    const payload = {
      ok: false,
      error: `這個演示只處理補助比對。請輸入：「${HAPPY_PATH_UTTERANCE}」`,
      notes: ["資格由規則引擎決定，不會用模型來授權欄位。", "模型看不到金庫。"],
    };
    mutate((s) => {
      appendChat(s, "user", message);
      appendChat(s, "agent", payload.error);
    });
    assertNoVaultLeak(payload, "plan_applications");
    return payload;
  }

  if (!situation.movedRecently) {
    const payload = {
      ok: false,
      error: "規則引擎沒有偵測到「搬家／遷徙」。快樂路徑請用：「我剛搬家，看我能申請什麼。」",
    };
    mutate((s) => {
      appendChat(s, "user", message);
      appendChat(s, "agent", payload.error);
    });
    assertNoVaultLeak(payload, "plan_applications");
    return payload;
  }

  const programs = matchPrograms(situation);
  const hint = ageHint(situation.childAgeMonths);

  mutate((s) => {
    appendChat(s, "user", message);
    s.plan = {
      utterance: message,
      matchedAt: new Date().toISOString(),
      programs,
      ageHint: hint,
      notes: [
        "資格比對只用規則引擎，不用語言模型決定授權。",
        "所得資料在金庫，但不進入任何建議匣。",
        "沒有「一次交出全部資料」的按鈕。",
      ],
    };
    proposeGrantsFromPlan(s, programs);
    appendChat(
      s,
      "agent",
      [
        "規則引擎比對結果（非模型授權）：",
        "",
        ...programs.flatMap((p, i) => [
          `${i + 1}. ${p.title} — ${p.agencyName}`,
          `   原因：${p.reasons.join("；")}`,
          `   本匣欄位：${p.requiredFields.join("、")}`,
          p.hint ? `   提示：${p.hint}` : "",
        ]),
        "",
        hint,
        "",
        "兩張授權匣已出現。請分別核准；每一匣只給該機關看得到的欄位。所得不會進入任何匣。",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });

  const payload = {
    ok: true,
    utterance: message,
    ageHint: hint,
    programs: programs.map((p) => ({
      grantId: p.grantId,
      title: p.title,
      agencyId: p.agencyId,
      agencyName: p.agencyName,
      reasons: p.reasons,
      requiredFieldIds: p.requiredFields,
      requiredFieldLabels: fieldLabels(p.requiredFields),
      hint: p.hint ?? null,
    })),
    grants: programs.map((p) => grantPublic(p.grantId)),
    notes: [
      "資格由規則引擎決定，模型不決定授權。",
      "欄位值仍在金庫；核准後才由授權層寫入機關收件匣。",
      "所得不會進入任何建議匣。",
    ],
  };
  assertNoVaultLeak(payload, "plan_applications");
  return payload;
}

export function approveGrant(grantIdRaw: string) {
  const grantId = requireGrantId(grantIdRaw);
  const { error } = approveGrantAndFetch(grantId);
  const grant = grantPublic(grantId);
  const payload = error
    ? { ok: false, error, grant }
    : {
        ok: true,
        grant,
        fetchedFieldIds: grant?.fields ?? [],
        note: "核准後授權層已把白名單欄位送入機關收件匣。模型看不到金庫值。所得不在此匣。",
      };
  assertNoVaultLeak(payload, "approve_grant");
  return payload;
}

export function fetchField(input: {
  grantId: string;
  fields?: string[];
  actor?: string;
}) {
  const grantId = requireGrantId(input.grantId);
  const actor = normalizeActor(input.actor);
  const fields =
    input.fields && input.fields.length > 0
      ? input.fields
      : householdOverscopeFields();

  const { result } = fetchWithGrant(grantId, fields, actor);

  if (!result.ok) {
    const payload = {
      ok: false,
      status: 403 as const,
      code: result.code,
      error: result.error,
      grantId,
      deniedFields: result.deniedFields ?? [],
      deniedFieldLabels: fieldLabels(result.deniedFields ?? []),
      actor: actor.role,
      audited: true,
    };
    assertNoVaultLeak(payload, "fetch_field");
    return payload;
  }

  const fetchedFieldIds = Object.keys(result.fields);
  const payload = {
    ok: true,
    status: 200 as const,
    grantId: result.grantId,
    fetchedFieldIds,
    fetchedFieldLabels: fieldLabels(fetchedFieldIds),
    deliveredTo: "agency-envelope",
    note: "欄位值已送入機關收件匣，未回傳給模型。",
  };
  assertNoVaultLeak(payload, "fetch_field");
  return payload;
}

export function submitApp(grantIdRaw: string) {
  const grantId = requireGrantId(grantIdRaw);
  const { error } = submitApplication(grantId);
  const grant = grantPublic(grantId);
  const payload = error
    ? { ok: false, error, grant }
    : {
        ok: true,
        grant,
        note: `送件完成，匣 ${grantId} 已耗用。重放 fetch_field 將 403。`,
      };
  assertNoVaultLeak(payload, "submit_application");
  return payload;
}

export function revokeApp(grantIdRaw: string, reason?: string) {
  const grantId = requireGrantId(grantIdRaw);
  const { error } = revokeGrant(
    grantId,
    reason?.trim() || `委託人撤銷匣 ${grantId}`,
  );
  const grant = grantPublic(grantId);
  const payload = error
    ? { ok: false, error, grant }
    : { ok: true, grant, note: `匣 ${grantId} 已撤銷。` };
  assertNoVaultLeak(payload, "revoke_grant");
  return payload;
}

export function getAudit() {
  const state = getState();
  const sight = agentSight(state);
  const payload = {
    ok: true,
    incomeNeverEnteredGrant: incomeNeverGranted(state),
    incomeFieldIds: sight.incomeHeldBack,
    neverGrantedFieldIds: sight.neverGranted,
    grants: state.grants.map((g) => ({
      id: g.id,
      status: g.status,
      fieldIds: g.fields,
      containsIncome: false,
    })),
    audit: state.audit.map((entry) => ({
      id: entry.id,
      at: entry.at,
      actor: entry.actor,
      actorRole: entry.actorRole,
      action: entry.action,
      grantId: entry.grantId,
      detail: entry.detail,
      deniedFields: entry.deniedFields ?? [],
    })),
    note: "所得從未進入任何授權匣。稽核只記動作，不含金庫值。",
  };
  assertNoVaultLeak(payload, "get_audit");
  return payload;
}

export type ToolName = (typeof TOOL_NAMES)[number];

export function callTool(
  name: ToolName,
  args: Record<string, unknown>,
): { data: unknown; isError: boolean } {
  switch (name) {
    case "plan_applications":
      return {
        data: planApplications(String(args.utterance ?? "")),
        isError: false,
      };
    case "approve_grant": {
      const data = approveGrant(String(args.grantId ?? ""));
      return { data, isError: data.ok === false };
    }
    case "fetch_field": {
      const data = fetchField({
        grantId: String(args.grantId ?? ""),
        fields: Array.isArray(args.fields)
          ? args.fields.map(String)
          : undefined,
        actor: args.actor != null ? String(args.actor) : undefined,
      });
      return { data, isError: data.ok === false };
    }
    case "submit_application": {
      const data = submitApp(String(args.grantId ?? ""));
      return { data, isError: data.ok === false };
    }
    case "revoke_grant": {
      const data = revokeApp(
        String(args.grantId ?? ""),
        args.reason != null ? String(args.reason) : undefined,
      );
      return { data, isError: data.ok === false };
    }
    case "get_audit":
      return { data: getAudit(), isError: false };
    default: {
      const never: never = name;
      return { data: { ok: false, error: `未知工具：${never}` }, isError: true };
    }
  }
}
