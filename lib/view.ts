import { FIELD_META, INCOME_FIELDS } from "./fields";
import type { DemoState, FieldId, GrantId, GrantStatus } from "./types";
import { FIELD_IDS } from "./types";

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Taipei",
  });
}

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  proposed: "待核准",
  active: "有效",
  revoked: "已撤銷",
  consumed: "已耗用",
};

export function groupedFields(ids: FieldId[]) {
  const groups = new Map<string, FieldId[]>();
  for (const id of ids) {
    const group = FIELD_META[id].group;
    const list = groups.get(group) ?? [];
    list.push(id);
    groups.set(group, list);
  }
  return [...groups.entries()];
}

export function agentSight(state: DemoState) {
  const readableNow = new Set<FieldId>();
  const consumed = new Set<FieldId>();
  const authorized = new Set<FieldId>();

  for (const grant of state.grants) {
    for (const field of grant.fields) authorized.add(field);
    const values = Object.keys(state.envelopes[grant.id]?.fields ?? {}) as FieldId[];
    if (grant.status === "active") {
      for (const field of values) readableNow.add(field);
    }
    if (grant.status === "consumed") {
      for (const field of values) consumed.add(field);
    }
  }

  const neverGranted = FIELD_IDS.filter((id) => !authorized.has(id));
  const incomeHeldBack = INCOME_FIELDS.filter((id) => !authorized.has(id));

  return {
    readableNow: [...readableNow],
    consumed: [...consumed],
    neverGranted,
    incomeHeldBack,
    authorized: [...authorized],
  };
}

export function envelopeHasIncome(state: DemoState, grantId: GrantId): boolean {
  const fields = state.envelopes[grantId]?.fields ?? {};
  return INCOME_FIELDS.some((id) => id in fields);
}
