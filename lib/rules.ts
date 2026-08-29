import { JIA_FIELDS, YI_FIELDS } from "./fields";
import type { ProgramPlan } from "./types";

/** Frozen demo "today" so the 1-year-old child stays in the 0–2 band. */
export const DEMO_TODAY = "2026-08-29";

/**
 * Situation the principal *told* the agent. Used only by the rule engine.
 * Never read from the MyData vault — eligibility does not open envelopes.
 */
export const PERSONA_DECLARED = {
  name: "林曉晴",
  childBirthDate: "2025-07-15",
  hasResidentialMeter: true,
} as const;

export const HAPPY_PATH_UTTERANCE = "我剛搬家，看我能申請什麼。";

export type DeclaredSituation = {
  movedRecently: boolean;
  childAgeMonths: number;
  hasResidentialMeter: boolean;
};

export function monthsBetween(isoDate: string, todayIso: string): number {
  const from = new Date(`${isoDate}T00:00:00Z`);
  const to = new Date(`${todayIso}T00:00:00Z`);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

export function detectIntent(utterance: string): boolean {
  const t = utterance.replace(/\s+/g, "");
  return /搬家|遷徙|剛搬|搬到|遷入|申請|補助|津貼|能申|可以申/.test(t);
}

export function situationFromUtterance(utterance: string): DeclaredSituation | null {
  if (!detectIntent(utterance)) return null;
  return {
    movedRecently: /搬家|遷徙|剛搬|搬到|遷入/.test(utterance.replace(/\s+/g, "")),
    childAgeMonths: monthsBetween(PERSONA_DECLARED.childBirthDate, DEMO_TODAY),
    hasResidentialMeter: PERSONA_DECLARED.hasResidentialMeter,
  };
}

/**
 * Deterministic eligibility. LLM must never call this with extra fields,
 * and must never be used to mint grants.
 */
export function matchPrograms(situation: DeclaredSituation): ProgramPlan[] {
  const programs: ProgramPlan[] = [];
  const childInBand =
    situation.childAgeMonths >= 0 && situation.childAgeMonths < 24;

  if (situation.movedRecently && childInBand) {
    programs.push({
      grantId: "G-甲",
      title: "育兒津貼",
      agencyId: "jia",
      agencyName: "甲｜新北市社會局",
      reasons: [
        "剛完成遷徙，戶籍已從臺北市改到新北市",
        "家中有 0–2 歲幼兒，落在育兒津貼年齡帶",
      ],
      requiredFields: [...JIA_FIELDS],
      hint: "孩子滿 2 歲後，育兒津貼條件會改變，需重新評估",
    });
  }

  if (situation.hasResidentialMeter) {
    programs.push({
      grantId: "G-乙",
      title: "冷氣汰換補助",
      agencyId: "yi",
      agencyName: "乙｜經濟部能源署 × 台灣電力公司",
      reasons: [
        "有住宅用電戶，可用電表號與近三月用電量證明居住事實",
      ],
      requiredFields: [...YI_FIELDS],
    });
  }

  return programs;
}

export function ageHint(childAgeMonths: number): string {
  const years = Math.floor(childAgeMonths / 12);
  const months = childAgeMonths % 12;
  const remain = Math.max(0, 24 - childAgeMonths);
  return `幼兒目前約 ${years} 歲又 ${months} 個月。再 ${remain} 個月就滿 2 歲，育兒津貼條件會改變。`;
}
