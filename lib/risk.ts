import {
  CLAIM_DEFS,
  isClaimId,
  SENSITIVITY_LABEL,
  SPECIAL_CLAIMS,
  type ClaimId,
  type Sensitivity,
} from "./claims";
import { claimsOutsidePurpose, PURPOSES, type PurposeId, type PurposeDef } from "./purposes";
import type { AuditEntry, Delegation, RiskLevel } from "./types";

const LEVELS: RiskLevel[] = ["low", "elevated", "blocked"];

const ORDER: Record<Sensitivity, number> = {
  predicate: 0,
  pseudonym: 1,
  personal: 2,
  special: 3,
};

export function highestSensitivity(claims: string[]): Sensitivity {
  let worst: Sensitivity = "predicate";
  for (const c of claims) {
    if (!isClaimId(c)) continue;
    const s = CLAIM_DEFS[c].sensitivity;
    if (ORDER[s] > ORDER[worst]) worst = s;
  }
  return worst;
}

export type RiskAssessment = {
  level: RiskLevel;
  notes: string[];
  blockedClaims: string[];
};

/**
 * Interception, evaluated before the principal is ever asked to sign.
 *
 * `blocked` means the request is refused no matter who consents: either the
 * claim falls outside the agency's statutory purpose, or it is special-category
 * data, or the standing delegation does not reach that far. `elevated` still
 * needs an explicit extra confirmation from the principal.
 */
export function assessRisk(input: {
  purpose: PurposeId;
  claims: string[];
  delegation: Delegation;
  recentAudit: AuditEntry[];
  now: Date;
  purposes?: Record<string, PurposeDef>;
}): RiskAssessment {
  const notes: string[] = [];
  const blockedClaims: string[] = [];
  let rank = 0;
  const escalate = (next: RiskLevel) => {
    rank = Math.max(rank, LEVELS.indexOf(next));
  };
  const blocked = () => LEVELS[rank] === "blocked";

  const table = input.purposes ?? PURPOSES;
  const purpose: PurposeDef | undefined = table[input.purpose];
  if (!purpose) {
    return {
      level: "blocked",
      notes: [`目的「${input.purpose}」未掛在登記台。`],
      blockedClaims: [...input.claims],
    };
  }

  // 1. Outside the statutory scope of the purpose — the second key refuses.
  const outside = claimsOutsidePurpose(input.purpose, input.claims, table);
  if (outside.length) {
    blockedClaims.push(...outside);
    notes.push(
      `${outside.map((c) => (isClaimId(c) ? CLAIM_DEFS[c].label : c)).join("、")} 不在「${purpose.title}」的法定職務必要範圍內（個資法 §15）。`,
    );
    escalate("blocked");
  }

  // 2. Special-category data is refused regardless of consent.
  // Each withheld claim states its own ground: the law forbids one, this design
  // excludes the other. Collapsing them into one sentence would overclaim.
  const withheld = input.claims.filter((c) => SPECIAL_CLAIMS.includes(c as ClaimId));
  if (withheld.length) {
    blockedClaims.push(...withheld);
    for (const claim of withheld) {
      const def = CLAIM_DEFS[claim as ClaimId];
      notes.push(`${def.label}：${def.withholdBasis}，無論委託人是否同意都攔截。`);
    }
    escalate("blocked");
  }

  // 3. Standing delegation must actually cover this.
  if (!input.delegation.active) {
    notes.push("委託已停用，代理人不能再簽任何新的匣。");
    escalate("blocked");
  } else if (new Date(input.delegation.validUntil).getTime() < input.now.getTime()) {
    notes.push("委託已逾期，需要委託人重新設定。");
    escalate("blocked");
  } else {
    if (!input.delegation.agencies.includes(purpose.agency)) {
      notes.push(`委託範圍不含機關「${purpose.agencyName}」。`);
      escalate("blocked");
    }
    if (!input.delegation.purposes.includes(input.purpose)) {
      notes.push(`委託範圍不含目的「${purpose.title}」。`);
      escalate("blocked");
    }
    const worst = highestSensitivity(input.claims);
    // An unrecognised ceiling means no ceiling was set; refuse rather than
    // let the comparison quietly evaluate to false and pass everything.
    const ceiling = ORDER[input.delegation.maxSensitivity] ?? -1;
    if (ORDER[worst] > ceiling) {
      notes.push(
        `本匣含「${SENSITIVITY_LABEL[worst]}」，超過委託設定的上限「${SENSITIVITY_LABEL[input.delegation.maxSensitivity]}」。`,
      );
      escalate("blocked");
    }
  }

  // 4. Raw personal data still passes, but never silently.
  const personal = input.claims.filter(
    (c) => isClaimId(c) && CLAIM_DEFS[c].sensitivity === "personal",
  );
  if (personal.length && !blocked()) {
    notes.push(
      `本匣含原始個資（${personal.map((c) => CLAIM_DEFS[c as ClaimId].label).join("、")}），需要委託人額外確認。`,
    );
    escalate("elevated");
  }

  // 5. Repeated redemption of the same purpose in a short window.
  const windowMs = 60_000;
  const repeats = input.recentAudit.filter(
    (e) =>
      e.action === "redeem" &&
      e.detail.includes(purpose.title) &&
      input.now.getTime() - new Date(e.at).getTime() < windowMs,
  ).length;
  if (repeats >= 2) {
    notes.push(`一分鐘內已兌現「${purpose.title}」${repeats} 次，疑似異常取用，需再確認。`);
    escalate("elevated");
  }

  if (!notes.length) {
    notes.push("僅含述詞與機關專屬假名，未涉原始個資，落在法定職務必要範圍內。");
  }

  return { level: LEVELS[rank], notes, blockedClaims: [...new Set(blockedClaims)] };
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: "一般",
  elevated: "需額外確認",
  blocked: "已攔截",
};
