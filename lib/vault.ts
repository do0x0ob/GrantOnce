import type { FieldId } from "./types";

/** Fake MyData vault. Synthetic demo data only — not a real person. */
export const VAULT: {
  principalId: "P-lin-demo";
  name: "林曉晴";
  records: Record<FieldId, string>;
} = {
  principalId: "P-lin-demo",
  name: "林曉晴",
  records: {
    "household.city": "新北市",
    "household.address": "新北市板橋區示範路 88 號",
    "household.previousCity": "臺北市",
    "household.moveDate": "2026-06-01",
    "household.householdId": "HH-DEMO-3388",
    "parentChild.childName": "林小禾",
    "parentChild.childBirthDate": "2025-07-15",
    "parentChild.relation": "母親",
    "income.annualIncome": "NT$ 720,000",
    "income.taxYear": "2025",
    "nhi.cardId": "NHI-DEMO-2201",
    "nhi.status": "加保中",
    "taipower.meterId": "TP-DEMO-551002",
    "taipower.usage.m1": "286 kWh（2026-05）",
    "taipower.usage.m2": "312 kWh（2026-06）",
    "taipower.usage.m3": "341 kWh（2026-07）",
  },
};

export function readVaultFields(ids: FieldId[]): Partial<Record<FieldId, string>> {
  const out: Partial<Record<FieldId, string>> = {};
  for (const id of ids) {
    out[id] = VAULT.records[id];
  }
  return out;
}
