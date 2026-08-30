import {
  isLivePurposeId as purposeIsLive,
  purposesFrom,
  validatePurposeDraft,
  type PurposeDraft,
} from "./registry";
import { appendAudit, getState, mutate } from "./store";
import type { DemoState } from "./types";

export function livePurposes(): ReturnType<typeof purposesFrom> {
  return purposesFrom(getState());
}

export function livePurpose(id: string) {
  return livePurposes()[id];
}

export function isLivePurposeId(value: string, state = getState()): boolean {
  return purposeIsLive(value, state);
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
  const current = getState();
  if (!isLivePurposeId(trimmed, current)) {
    return { state: current, error: `沒有已掛上的目的：${trimmed}` };
  }
  const def = purposesFrom(current)[trimmed];
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
