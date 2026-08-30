import { CLAIM_DEFS, ISSUERS, isClaimId, type ClaimId } from "./claims";
import { AGENCY_NAMES, isKnownAgency } from "./parties";
import { PURPOSES, type PurposeDef } from "./purposes";
import type { AgencyId, DemoState } from "./types";

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype", "tostring", "valueof"]);

export type PurposeDraft = {
  id: string;
  title: string;
  agency: string;
  privacyBasis: string[];
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

export function isLivePurposeId(
  value: string,
  state: Pick<DemoState, "registeredPurposes" | "retiredPurposes">,
): boolean {
  if (FORBIDDEN.has(value.toLowerCase())) return false;
  return Object.hasOwn(purposesFrom(state), value);
}

/** Live row, or builtin fallback for titles of already-issued grants. */
export function resolvePurpose(
  id: string,
  state: Pick<DemoState, "registeredPurposes" | "retiredPurposes">,
): PurposeDef | undefined {
  return purposesFrom(state)[id] ?? PURPOSES[id];
}

export function validatePurposeDraft(draft: PurposeDraft): { def?: PurposeDef; error?: string } {
  const id = draft.id.trim().toLowerCase();
  if (FORBIDDEN.has(id) || !/^[a-z][a-z0-9-]{1,63}$/.test(id)) {
    return { error: "目的 ID 只能是小寫英文、數字與連字號。" };
  }
  const title = draft.title.trim();
  if (title.length < 2) return { error: "請填目的名稱。" };
  if (!isKnownAgency(draft.agency)) return { error: "只能掛到已上線的兌現機關（jia / yi）。" };
  const basis = draft.privacyBasis.map((line) => line.trim()).filter(Boolean);
  if (basis.length === 0) return { error: "至少要有一條個資法依據。" };
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
    // Builtins carry the 甲／乙／丙 labels; a runtime purpose gets one off its
    // own id rather than a hand-picked character.
    slot: `G-${id}`,
    slotAliases: [id],
    agency: draft.agency as AgencyId,
    agencyName: AGENCY_NAMES[draft.agency as AgencyId],
    privacyBasis: basis,
    allowedClaims: claims,
    maxTtlSeconds: ttl,
    necessity,
  };
  return { def };
}

export function issuerInventory() {
  const byIssuer = new Map<
    string,
    { issuer: string; issuerName: string; claims: { id: ClaimId; label: string; sensitivity: string }[] }
  >();
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
    updatedAt: new Date().toISOString(),
  };
}
