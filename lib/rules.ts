import { searchCatalog, topicsFromUtterance } from "./catalog";
import { ageBandOf, DEMO_TODAY, monthsBetween } from "./claims";
import { PURPOSES } from "./purposes";
import type { DemoState, ProgramPlan } from "./types";

/**
 * What the principal told the agent in conversation. The rule engine reads only
 * this: matching eligibility never opens the vault and never mints a grant.
 */
export const PERSONA_DECLARED = {
  childBirthDate: "2025-07-15",
  hasResidentialMeter: true,
} as const;

export const HAPPY_PATH_UTTERANCE = "我剛搬家，看我能申請什麼。";

export type DeclaredSituation = {
  movedRecently: boolean;
  /** Explicit childcare ask, or a move that unlocks the bundled profile. */
  wantsChildcare: boolean;
  /** Explicit air-con ask, or a move that unlocks the bundled profile. */
  wantsAircon: boolean;
  childAgeMonths: number;
  hasResidentialMeter: boolean;
};

export function effectiveToday(state: DemoState): string {
  const base = new Date(`${DEMO_TODAY}T00:00:00Z`);
  const shifted = new Date(base.getTime() + (state.clockOffsetDays ?? 0) * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export function childAgeMonthsAt(today: string): number {
  return monthsBetween(PERSONA_DECLARED.childBirthDate, today);
}

export function detectIntent(utterance: string): boolean {
  return topicsFromUtterance(utterance).length > 0 || searchCatalog(utterance).length > 0;
}

export function situationFromUtterance(
  utterance: string,
  today: string = DEMO_TODAY,
): DeclaredSituation | null {
  if (!detectIntent(utterance)) return null;
  const topics = topicsFromUtterance(utterance);
  const movedRecently = topics.includes("move");
  return {
    movedRecently,
    wantsChildcare: movedRecently || topics.includes("childcare"),
    wantsAircon: movedRecently || topics.includes("aircon"),
    childAgeMonths: childAgeMonthsAt(today),
    hasResidentialMeter: PERSONA_DECLARED.hasResidentialMeter,
  };
}

/**
 * Deterministic eligibility. The model never calls this with extra claims and is
 * never the thing that mints a grant.
 */
export function matchPrograms(situation: DeclaredSituation): ProgramPlan[] {
  const programs: ProgramPlan[] = [];
  const band = ageBandOf(situation.childAgeMonths);

  if (situation.wantsChildcare && situation.movedRecently && band === "0-2") {
    const purpose = PURPOSES["childcare-allowance"];
    programs.push({
      grantId: "G-甲",
      purpose: purpose.id,
      title: purpose.title,
      agencyId: purpose.agency,
      agencyName: `甲｜${purpose.agencyName}`,
      reasons: [
        "剛完成遷徙，戶籍已從臺北市改到新北市",
        "家中幼兒落在 0–2 歲育兒津貼年齡帶",
      ],
      claims: [...purpose.allowedClaims],
      hint: "滿 2 歲後改適用「未滿 5 歲幼兒托育補助」，屆時要換一張新的匣",
    });
  }

  if (situation.wantsAircon && situation.hasResidentialMeter) {
    const purpose = PURPOSES["aircon-subsidy"];
    programs.push({
      grantId: "G-乙",
      purpose: purpose.id,
      title: purpose.title,
      agencyId: purpose.agency,
      agencyName: `乙｜${purpose.agencyName}`,
      reasons: ["有住宅用電戶，可用用電級距證明居住事實"],
      claims: [...purpose.allowedClaims],
    });
  }

  return programs;
}

export function ageHint(months: number): string {
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (months >= 24) {
    return `幼兒已滿 ${years} 歲又 ${rem} 個月，離開 0–2 歲帶，育兒津貼條件已改變。`;
  }
  return `幼兒目前約 ${years} 歲又 ${rem} 個月。再 ${24 - months} 個月滿 2 歲，育兒津貼條件會改變。`;
}

export type PendingChange = {
  kind: "eligibility-change" | "credential-expiry";
  title: string;
  body: string;
  grantId: ProgramPlan["grantId"] | null;
};

/**
 * The proactive half. Instead of waiting for the principal to re-ask, the agent
 * watches for the conditions that will change their entitlement and pushes.
 */
export function scanForChanges(state: DemoState, now: Date): PendingChange[] {
  const today = effectiveToday(state);
  const months = childAgeMonthsAt(today);
  const out: PendingChange[] = [];

  if (months >= 24) {
    out.push({
      kind: "eligibility-change",
      title: "育兒津貼資格已改變",
      body: `幼兒已滿 2 歲，離開 0–2 歲年齡帶。原「育兒津貼」匣的 child.ageBand 述詞已變成 ${ageBandOf(months)}，該匣不再對應正確補助；需要重新比對並簽一張新的匣。`,
      grantId: "G-甲",
    });
  } else if (24 - months <= 3) {
    out.push({
      kind: "eligibility-change",
      title: `再 ${24 - months} 個月育兒津貼條件會變`,
      body: "幼兒即將滿 2 歲，屆時改適用未滿 5 歲幼兒托育補助，需要不同的述詞組合。先提醒，不預先取得任何資料。",
      grantId: "G-甲",
    });
  }

  for (const cred of state.wallet) {
    if (cred.revoked) continue;
    const left = new Date(cred.expiresAt).getTime() - now.getTime();
    if (left <= 0) {
      out.push({
        kind: "credential-expiry",
        title: `憑證已到期：${cred.label}`,
        body: `${cred.issuerName} 簽發的「${cred.label}」憑證已過期，下次申請需重新取得。`,
        grantId: null,
      });
    }
  }

  return out;
}

/** The three things the agent says about how it works. Kept in one place so the
 *  web and MCP paths cannot drift apart. */
export const AGENT_NOTES = [
  "公開搜尋不受目的登記表限制；登記表只決定能不能 mint Grant。",
  "資格比對與發票只用規則引擎，模型不決定授權，也不能發明述詞。",
  "匣裡放的是述詞，不是原始欄位。",
  "取得資料要兩把鑰匙：委託人簽章，加上機關的法定職務範圍。",
] as const;

export const AGENT_NAME = "補助代理人";
