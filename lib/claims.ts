import { pairwiseId } from "./crypto";
import type { FieldId } from "./types";
import { VAULT } from "./vault";

/** Frozen demo "today" so the one-year-old stays inside the 0–2 band. */
export const DEMO_TODAY = "2026-08-29";

export const CLAIM_IDS = [
  // derived predicates — carry no personal data at all
  "resident.inNewTaipei",
  "resident.movedWithin12m",
  "parentChild.verified",
  "child.ageBand",
  "power.residentialMeter",
  "power.usageBand",
  // pairwise pseudonym — identifies an account to ONE agency only
  "power.accountRef",
  // raw personal data — present in the vault, deliberately hard to obtain
  "raw.household.address",
  "raw.household.householdId",
  "raw.child.name",
  "raw.child.birthDate",
  "raw.nhi.cardId",
  "raw.income.annual",
] as const;

export type ClaimId = (typeof CLAIM_IDS)[number];

/** Drives both the consent screen and the risk engine. */
export type Sensitivity = "predicate" | "pseudonym" | "personal" | "special";

export type IssuerId = "household-office" | "taipower" | "nhia" | "tax";

export const ISSUERS: Record<IssuerId, { name: string }> = {
  "household-office": { name: "戶政事務所" },
  taipower: { name: "台灣電力公司" },
  nhia: { name: "衛福部中央健康保險署" },
  tax: { name: "財政部財政資訊中心" },
};

export type ClaimDef = {
  id: ClaimId;
  label: string;
  /** What the agency actually receives, described for the consent screen. */
  shape: string;
  sensitivity: Sensitivity;
  issuer: IssuerId;
  /** Vault fields consumed to compute this. Recorded for audit; never released. */
  derivedFrom: FieldId[];
  /** How long an issued credential stays reusable, in days. */
  ttlDays: number;
  /**
   * Why this claim is never released, when it never is.
   *
   * The two withheld claims are withheld on different grounds and saying so
   * matters: 健保 is 個資法 §6 特種個資, which the law forbids outright, while
   * 所得 is ordinary personal data that this design excludes itself under the
   * §5 proportionality rule. Calling both "特種個資" would dress a policy choice
   * up as a legal prohibition.
   */
  withholdBasis?: string;
  /**
   * Derives the claim. `today` is the effective date, so a predicate about age
   * changes when the calendar does rather than being frozen at build time.
   */
  compute: (ctx: { subject: string; audience: string; today: string }) => string;
};

function usageKwh(raw: string): number {
  return Number(raw.replace(/[^\d.]/g, "").slice(0, 6)) || 0;
}

export function monthsBetween(isoDate: string, todayIso: string): number {
  const from = new Date(`${isoDate}T00:00:00Z`);
  const to = new Date(`${todayIso}T00:00:00Z`);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

export function childAgeMonths(today: string = DEMO_TODAY): number {
  return monthsBetween(VAULT.records["parentChild.childBirthDate"], today);
}

export function ageBandOf(months: number): string {
  if (months < 24) return "0-2";
  if (months < 72) return "2-6";
  return "6+";
}

export const CLAIM_DEFS: Record<ClaimId, ClaimDef> = {
  "resident.inNewTaipei": {
    id: "resident.inNewTaipei",
    label: "是否設籍新北市",
    shape: "是／否",
    sensitivity: "predicate",
    issuer: "household-office",
    derivedFrom: ["household.city"],
    ttlDays: 30,
    compute: () => String(VAULT.records["household.city"] === "新北市"),
  },
  "resident.movedWithin12m": {
    id: "resident.movedWithin12m",
    label: "是否一年內遷入",
    shape: "是／否",
    sensitivity: "predicate",
    issuer: "household-office",
    derivedFrom: ["household.moveDate"],
    ttlDays: 30,
    compute: ({ today }) => String(monthsBetween(VAULT.records["household.moveDate"], today) < 12),
  },
  "parentChild.verified": {
    id: "parentChild.verified",
    label: "是否為法定親子關係",
    shape: "是／否",
    sensitivity: "predicate",
    issuer: "household-office",
    derivedFrom: ["parentChild.relation", "parentChild.childName"],
    // The birth-certificate pain point: issued once, reusable for a year.
    ttlDays: 365,
    compute: () => String(VAULT.records["parentChild.relation"].length > 0),
  },
  "child.ageBand": {
    id: "child.ageBand",
    label: "幼兒年齡帶",
    shape: "0-2 ／ 2-6 ／ 6+",
    sensitivity: "predicate",
    issuer: "household-office",
    derivedFrom: ["parentChild.childBirthDate"],
    // Deliberately short: the band itself expires when the child ages out.
    ttlDays: 30,
    compute: ({ today }) => ageBandOf(childAgeMonths(today)),
  },
  "power.residentialMeter": {
    id: "power.residentialMeter",
    label: "是否有住宅用電戶",
    shape: "是／否",
    sensitivity: "predicate",
    issuer: "taipower",
    derivedFrom: ["taipower.meterId"],
    ttlDays: 90,
    compute: () => String(VAULT.records["taipower.meterId"].startsWith("TP-")),
  },
  "power.usageBand": {
    id: "power.usageBand",
    label: "近三月平均用電分級",
    shape: "低 ／ 中 ／ 高",
    sensitivity: "predicate",
    issuer: "taipower",
    derivedFrom: ["taipower.usage.m1", "taipower.usage.m2", "taipower.usage.m3"],
    ttlDays: 30,
    compute: () => {
      const avg =
        (usageKwh(VAULT.records["taipower.usage.m1"]) +
          usageKwh(VAULT.records["taipower.usage.m2"]) +
          usageKwh(VAULT.records["taipower.usage.m3"])) /
        3;
      if (avg < 200) return "低";
      if (avg <= 400) return "中";
      return "高";
    },
  },
  "power.accountRef": {
    id: "power.accountRef",
    label: "用電帳戶識別（機關專屬假名）",
    shape: "每個機關拿到不同的代號，彼此無法比對",
    sensitivity: "pseudonym",
    issuer: "taipower",
    derivedFrom: ["taipower.meterId"],
    ttlDays: 90,
    compute: ({ subject, audience }) =>
      pairwiseId(`${subject}/${VAULT.records["taipower.meterId"]}`, audience),
  },
  "raw.household.address": {
    id: "raw.household.address",
    label: "戶籍地址（原始值）",
    shape: "完整地址字串",
    sensitivity: "personal",
    issuer: "household-office",
    derivedFrom: ["household.address"],
    ttlDays: 7,
    compute: () => VAULT.records["household.address"],
  },
  "raw.household.householdId": {
    id: "raw.household.householdId",
    label: "戶號（原始值）",
    shape: "戶號字串",
    sensitivity: "personal",
    issuer: "household-office",
    derivedFrom: ["household.householdId"],
    ttlDays: 7,
    compute: () => VAULT.records["household.householdId"],
  },
  "raw.child.name": {
    id: "raw.child.name",
    label: "子女姓名（原始值）",
    shape: "姓名字串",
    sensitivity: "personal",
    issuer: "household-office",
    derivedFrom: ["parentChild.childName"],
    ttlDays: 7,
    compute: () => VAULT.records["parentChild.childName"],
  },
  "raw.child.birthDate": {
    id: "raw.child.birthDate",
    label: "子女出生日期（原始值）",
    shape: "YYYY-MM-DD",
    sensitivity: "personal",
    issuer: "household-office",
    derivedFrom: ["parentChild.childBirthDate"],
    ttlDays: 7,
    compute: () => VAULT.records["parentChild.childBirthDate"],
  },
  "raw.nhi.cardId": {
    id: "raw.nhi.cardId",
    label: "健保卡號（原始值）",
    shape: "卡號字串",
    sensitivity: "special",
    issuer: "nhia",
    derivedFrom: ["nhi.cardId"],
    ttlDays: 1,
    withholdBasis: "個資法 §6 第 1 項列舉之特種個資（醫療、健康檢查），法律禁止蒐集處理利用",
    compute: () => VAULT.records["nhi.cardId"],
  },
  "raw.income.annual": {
    id: "raw.income.annual",
    label: "綜合所得總額（原始值）",
    shape: "金額字串",
    sensitivity: "special",
    issuer: "tax",
    derivedFrom: ["income.annualIncome", "income.taxYear"],
    ttlDays: 1,
    withholdBasis:
      "非 §6 特種個資，但依 §5 比例原則由本設計自行排除：這些補助的核定不需要所得",
    compute: () => VAULT.records["income.annualIncome"],
  },
};

export function isClaimId(value: string): value is ClaimId {
  return Object.hasOwn(CLAIM_DEFS, value);
}

export const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  predicate: "述詞（不含個資）",
  pseudonym: "機關專屬假名",
  personal: "原始個資",
  special: "不得授權",
};

/** Claims no purpose may ever carry, whatever the principal signs. */
export const SPECIAL_CLAIMS: ClaimId[] = CLAIM_IDS.filter(
  (id) => CLAIM_DEFS[id].sensitivity === "special",
);
