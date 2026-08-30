import { CLAIM_DEFS, ISSUERS, isClaimId, type ClaimId } from "./claims";
import { AGENCY_NAMES, isKnownAgency } from "./parties";
import { PURPOSES, type PurposeDef } from "./purposes";
import { appendAudit, getState, mutate, nowIso } from "./store";
import type { AgencyId, DemoState } from "./types";

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype", "tostring", "valueof"]);

export type PurposeDraft = {
  id: string;
  title: string;
  agency: string;
  legalBasis: string[];
  allowedClaims: string[];
  maxTtlSeconds: number;
  necessity: string;
};

export function purposesFrom(
  state: Pick<DemoState, "registeredPurposes" | "retiredPurposes">,
): Record<string, PurposeDef> {
  const retired = new Set(state.retiredPurposes ?? []);
  const merged: Record<string, PurposeDef> = { ...PURPOSES };
  for (const [id, def] of Object.entries(state.registeredPurposes ?? {})) {
    if (!id || FORBIDDEN.has(id.toLowerCase()) || retired.has(id)) continue;
    merged[id] = def;
  }
  for (const id of retired) delete merged[id];
  return merged;
}

export function livePurposes(): Record<string, PurposeDef> {
  return purposesFrom(getState());
}

export function livePurpose(id: string): PurposeDef | undefined {
  return livePurposes()[id];
}

export function isLivePurposeId(value: string, state?: DemoState): boolean {
  if (FORBIDDEN.has(value.toLowerCase())) return false;
  return Object.hasOwn(purposesFrom(state ?? getState()), value);
}

/** Live row, or builtin fallback for titles of already-issued grants. */
export function resolvePurpose(id: string, state?: DemoState): PurposeDef | undefined {
  const table = purposesFrom(state ?? getState());
  return table[id] ?? PURPOSES[id];
}

export function validatePurposeDraft(draft: PurposeDraft): { def?: PurposeDef; error?: string } {
  const id = draft.id.trim().toLowerCase();
  if (FORBIDDEN.has(id) || !/^[a-z][a-z0-9-]{1,63}$/.test(id)) {
    return { error: "目的 ID 只能是小寫英文、數字與連字號。" };
  }
  const title = draft.title.trim();
  if (title.length < 2) return { error: "請填目的名稱。" };
  if (!isKnownAgency(draft.agency)) return { error: "只能掛到已上線的兌現機關（jia / yi）。" };
  const basis = draft.legalBasis.map((line) => line.trim()).filter(Boolean);
  if (basis.length === 0) return { error: "至少要有一條法定依據。" };
  const claims: ClaimId[] = [];
  for (const raw of draft.allowedClaims) {
    if (!isClaimId(raw)) {
      return { error: `不能發明述詞「${raw}」。新述詞要發證機關先上線 adapter。` };
    }
    claims.push(raw);
  }
  if (claims.length === 0) return { error: "至少勾一項已上線的述詞。" };
  const ttl = Math.floor(Number(draft.maxTtlSeconds));
  if (!Number.isFinite(ttl) || ttl < 60 || ttl > 3600) {
    return { error: "效期須介於 60–3600 秒。" };
  }
  const necessity = draft.necessity.trim();
  if (necessity.length < 8) return { error: "請用白話寫為什麼這些述詞是必要範圍。" };

  const def: PurposeDef = {
    id,
    title,
    agency: draft.agency as AgencyId,
    agencyName: AGENCY_NAMES[draft.agency as AgencyId],
    legalBasis: basis,
    allowedClaims: claims,
    maxTtlSeconds: ttl,
    necessity,
  };
  return { def };
}

export function upsertPurpose(draft: PurposeDraft): { state: DemoState; error?: string } {
  const checked = validatePurposeDraft(draft);
  if (checked.error || !checked.def) {
    return { state: getState(), error: checked.error };
  }
  const def = checked.def;
  const state = mutate((s) => {
    s.registeredPurposes = { ...s.registeredPurposes, [def.id]: def };
    s.retiredPurposes = (s.retiredPurposes ?? []).filter((id) => id !== def.id);
    if (!s.delegation.purposes.includes(def.id)) {
      s.delegation.purposes = [...s.delegation.purposes, def.id];
    }
    appendAudit(s, {
      actor: `${def.agencyName}（登記台）`,
      actorRole: def.agency === "jia" ? "agency-jia" : "agency-yi",
      action: "register",
      detail: `掛上目的「${def.title}」（${def.id}），允許述詞 ${def.allowedClaims.join("、")}。`,
    });
  });
  return { state };
}

export function retirePurpose(id: string): { state: DemoState; error?: string } {
  const trimmed = id.trim();
  if (!isLivePurposeId(trimmed)) {
    return { state: getState(), error: `沒有已掛上的目的：${trimmed}` };
  }
  const def = livePurpose(trimmed)!;
  const state = mutate((s) => {
    s.retiredPurposes = [...new Set([...(s.retiredPurposes ?? []), trimmed])];
    delete s.registeredPurposes[trimmed];
    s.delegation.purposes = s.delegation.purposes.filter((item) => item !== trimmed);
    appendAudit(s, {
      actor: `${def.agencyName}（登記台）`,
      actorRole: def.agency === "jia" ? "agency-jia" : "agency-yi",
      action: "revoke",
      detail: `下架目的「${def.title}」（${trimmed}）。已提案的匣不會自動改寫。`,
    });
  });
  return { state };
}

export function issuerInventory() {
  const byIssuer = new Map<string, { issuer: string; issuerName: string; claims: { id: ClaimId; label: string; sensitivity: string }[] }>();
  for (const claim of Object.values(CLAIM_DEFS)) {
    const current = byIssuer.get(claim.issuer) ?? {
      issuer: claim.issuer,
      issuerName: ISSUERS[claim.issuer].name,
      claims: [],
    };
    current.claims.push({
      id: claim.id,
      label: claim.label,
      sensitivity: claim.sensitivity,
    });
    byIssuer.set(claim.issuer, current);
  }
  return [...byIssuer.values()];
}

export function registryView(state: DemoState) {
  const purposes = Object.values(purposesFrom(state)).map((def) => ({
    ...def,
    builtin: Object.hasOwn(PURPOSES, def.id),
    overridden: Object.hasOwn(state.registeredPurposes ?? {}, def.id),
  }));
  return {
    purposes,
    retiredPurposes: state.retiredPurposes ?? [],
    issuers: issuerInventory(),
    availableClaims: Object.values(CLAIM_DEFS).map((claim) => ({
      id: claim.id,
      label: claim.label,
      sensitivity: claim.sensitivity,
      issuerName: ISSUERS[claim.issuer].name,
      inventable: false,
    })),
    note: "兌現機關在這裡掛目的。發證機關上線的述詞才能勾。不能發明 disaster.* 這類還沒 adapter 的欄位。",
    updatedAt: nowIso(),
  };
}
