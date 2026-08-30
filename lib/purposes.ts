import type { ClaimId } from "./claims";
import type { AgencyId } from "./types";

export const PURPOSE_IDS = [
  "childcare-allowance",
  "childcare-service-subsidy",
  "aircon-subsidy",
] as const;
/** Builtin ids plus any purpose an agency hangs on the registry desk. */
export type PurposeId = string;

export type PurposeDef = {
  id: PurposeId;
  title: string;
  /** Display label for the capsule. Carries no authority; see GrantId. */
  slot: string;
  /** Aliases accepted on the wire, since HTTP headers must be ASCII. */
  slotAliases: string[];
  agency: AgencyId;
  agencyName: string;
  /**
   * The 個資法 grounds for this agency receiving anything at all. Verified
   * against the statute text; this is what the purpose registry actually
   * encodes, so it must be right.
   */
  privacyBasis: string[];
  /**
   * The programme's own enabling law. Optional on purpose: citing it wrongly
   * costs more than omitting it, so an entry appears only where the article has
   * been checked against 全國法規資料庫.
   */
  programBasis?: string[];
  /** Ceiling on what this purpose may ever carry. */
  allowedClaims: ClaimId[];
  /** Grants for this purpose may not outlive this. */
  maxTtlSeconds: number;
  /** Plain-language reason, rendered verbatim into the signed displayText. */
  necessity: string;
};

/**
 * The second key: 個資法 §15/§16 as a lookup table. Each purpose's statutory
 * ceiling on claims, enforced independently of what the principal signed — a
 * principal phished into approving 所得 is still refused here, because the
 * agency has no statutory basis to receive it.
 */
export const PURPOSES: Record<PurposeId, PurposeDef> = {
  "childcare-allowance": {
    id: "childcare-allowance",
    title: "育兒津貼",
    slot: "G-甲",
    slotAliases: ["G-jia", "G-A"],
    agency: "jia",
    agencyName: "新北市政府社會局",
    privacyBasis: [
      "個人資料保護法 §15 第 1 款：執行法定職務必要範圍內蒐集、處理",
      // The statutory-duty rule is §16's main clause. Its 款 one to seven are
      // the exceptions for 特定目的外之利用 — citing 第 1 款 here would point at
      // 「法律明文規定」, an exception, while meaning the rule.
      "個人資料保護法 §16 本文：於執行法定職務必要範圍內利用，並與蒐集之特定目的相符",
      "個人資料保護法 §5：不得逾越特定目的之必要範圍",
    ],
    programBasis: [
      "兒童及少年福利與權益保障法 §23 第 1 項第 3 款：直轄市主管機關辦理兒童托育服務",
      "同法 §23 第 2 項：前述補助之資格、條件、程序及金額，由主管機關定之",
    ],
    allowedClaims: [
      "resident.inNewTaipei",
      "resident.movedWithin12m",
      "parentChild.verified",
      "child.ageBand",
    ],
    maxTtlSeconds: 600,
    necessity:
      "核定育兒津貼只需確認「設籍本市」「一年內遷入」「具法定親子關係」「幼兒落在 0–2 歲」四件事，不需要姓名、地址、戶號或出生日期本身。",
  },
  /**
   * Where a child goes when they age out of 育兒津貼. Same agency, same statute,
   * a different age band — so the clock moving forward is not only a loss.
   */
  "childcare-service-subsidy": {
    id: "childcare-service-subsidy",
    title: "未滿 5 歲幼兒托育補助",
    slot: "G-丙",
    slotAliases: ["G-bing", "G-C"],
    agency: "jia",
    agencyName: "新北市政府社會局",
    privacyBasis: [
      "個人資料保護法 §15 第 1 款：執行法定職務必要範圍內蒐集、處理",
      "個人資料保護法 §16 本文：於執行法定職務必要範圍內利用，並與蒐集之特定目的相符",
      "個人資料保護法 §5：不得逾越特定目的之必要範圍",
    ],
    programBasis: [
      "兒童及少年福利與權益保障法 §23 第 1 項第 3 款：直轄市主管機關辦理兒童托育服務",
      "同法 §23 第 2 項：前述補助之資格、條件、程序及金額，由主管機關定之",
    ],
    allowedClaims: ["resident.inNewTaipei", "parentChild.verified", "child.ageBand"],
    maxTtlSeconds: 600,
    necessity:
      "幼兒滿 2 歲後改適用本項補助。核定同樣只需確認「設籍本市」「具法定親子關係」「幼兒年齡帶」，而親子關係可直接沿用皮夾裡既有的憑證，不必再調一次戶政資料。",
  },
  "aircon-subsidy": {
    id: "aircon-subsidy",
    title: "住宅冷氣汰換補助",
    slot: "G-乙",
    slotAliases: ["G-yi", "G-B"],
    agency: "yi",
    agencyName: "經濟部能源署 × 台灣電力公司",
    privacyBasis: [
      "個人資料保護法 §15 第 1 款：執行法定職務必要範圍內蒐集、處理",
      "個人資料保護法 §16 本文：於執行法定職務必要範圍內利用，並與蒐集之特定目的相符",
      "個人資料保護法 §5：不得逾越特定目的之必要範圍",
    ],
    // No programBasis: 節能家電補助 is run on special budget and administrative
    // rules; 能源管理法 §9 is about 能源查核制度, not subsidies, and this project
    // does not cite an article it has not verified.
    allowedClaims: ["power.residentialMeter", "power.usageBand", "power.accountRef"],
    maxTtlSeconds: 600,
    necessity:
      "核定節能補助只需確認「有住宅用電戶」與「用電級距」，並取得一個本署專屬的帳戶代號以供撥款核銷；不需要電號本身，也不需要逐月用電度數。",
  },
};

export function isPurposeId(value: string, table: Record<string, PurposeDef> = PURPOSES): value is PurposeId {
  if (value === "__proto__" || value === "constructor" || value === "toString") return false;
  return Object.hasOwn(table, value);
}

/** Canonical slot label for a raw input, or null when no purpose owns it. */
export function normalizeGrantId(raw: string): string | null {
  const purpose = purposeOfSlot(raw);
  return purpose ? PURPOSES[purpose].slot : null;
}

/** Resolves a slot label or alias back to the purpose that owns it. */
export function purposeOfSlot(raw: string): PurposeId | null {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  try {
    candidates.push(decodeURIComponent(trimmed));
  } catch {
    // ignore malformed percent-encoding
  }
  for (const value of candidates) {
    for (const id of PURPOSE_IDS) {
      const def = PURPOSES[id];
      if (value === def.slot || def.slotAliases.includes(value)) return id;
    }
  }
  return null;
}

/** Claims outside the statutory scope of this purpose. Empty means compliant. */
export function claimsOutsidePurpose(
  purpose: PurposeId,
  claims: string[],
  table: Record<string, PurposeDef> = PURPOSES,
): string[] {
  const def = table[purpose];
  if (!def) return [...claims];
  const allowed = new Set<string>(def.allowedClaims);
  return claims.filter((c) => !allowed.has(c));
}
