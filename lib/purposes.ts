import type { ClaimId } from "./claims";
import type { AgencyId } from "./types";

export const PURPOSE_IDS = ["childcare-allowance", "aircon-subsidy"] as const;
/** Builtin ids plus any purpose an agency hangs on the registry desk. */
export type PurposeId = string;

export type PurposeDef = {
  id: PurposeId;
  title: string;
  agency: AgencyId;
  agencyName: string;
  /** Statutory basis the agency relies on, shown on the consent screen. */
  legalBasis: string[];
  /** Words a person might use to name this programme. Used to narrow a request
   *  to what was actually asked for; never to widen it. */
  aliases: string[];
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
    agency: "jia",
    agencyName: "新北市政府社會局",
    legalBasis: [
      "個人資料保護法 §15 第 1 款：執行法定職務必要範圍內蒐集、處理",
      "個人資料保護法 §16 第 1 款：於執行法定職務必要範圍內利用",
      "個人資料保護法 §5：不得逾越特定目的之必要範圍",
      "兒童及少年福利與權益保障法 §23：直轄市主管機關辦理托育與育兒補助",
    ],
    aliases: ["育兒津貼", "育兒", "托育", "小孩", "幼兒", "帶小孩"],
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
  "aircon-subsidy": {
    id: "aircon-subsidy",
    title: "住宅冷氣汰換補助",
    agency: "yi",
    agencyName: "經濟部能源署 × 台灣電力公司",
    legalBasis: [
      "個人資料保護法 §15 第 1 款：執行法定職務必要範圍內蒐集、處理",
      "個人資料保護法 §16 第 1 款：於執行法定職務必要範圍內利用",
      "個人資料保護法 §5：不得逾越特定目的之必要範圍",
      "能源管理法 §9：主管機關辦理能源使用效率獎勵",
    ],
    aliases: ["冷氣", "空調", "節能", "家電", "汰換", "電費"],
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

/**
 * Purposes the sentence names, by title or alias.
 *
 * Only ever used to *narrow* a matched set: someone who asks for one benefit
 * should not be handed a capsule for another as well. It cannot add a programme
 * the rule engine did not match.
 */
export function namedPurposes(utterance: string): PurposeId[] {
  const text = utterance.replace(/\s+/g, "");
  return PURPOSE_IDS.filter((id) => {
    const def = PURPOSES[id];
    return text.includes(def.title) || def.aliases.some((alias) => text.includes(alias));
  });
}
