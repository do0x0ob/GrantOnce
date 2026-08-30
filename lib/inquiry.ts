import {
  catalogPublic,
  FLOOD_UTTERANCE,
  searchCatalog,
  topicsFromUtterance,
  type CatalogPublic,
  type TopicId,
} from "./catalog";
import { CLAIM_DEFS } from "./claims";
import { PURPOSES } from "./purposes";
import {
  AGENT_NOTES,
  ageHint,
  childAgeMonthsAt,
  HAPPY_PATH_UTTERANCE,
  matchPrograms,
  situationFromUtterance,
  type DeclaredSituation,
} from "./rules";
import type { ProgramPlan } from "./types";

export { FLOOD_UTTERANCE };

export type InquiryResult = {
  utterance: string;
  topics: TopicId[];
  situation: DeclaredSituation | null;
  programs: ProgramPlan[];
  catalog: CatalogPublic[];
  canIssue: boolean;
  closeReason: string | null;
};

function closeReasonFor(result: Omit<InquiryResult, "closeReason">): string | null {
  if (result.canIssue) return null;
  if (result.topics.includes("flood") || result.catalog.some((entry) => entry.id === "flood-relief")) {
    return "水災救助已列在目錄，但本部署沒有受災述詞與 issuer adapter。規則引擎不能發明述詞，也不能發票。";
  }
  if (result.catalog.some((entry) => entry.issuable)) {
    return "目錄有可發票的目的，但這句話沒對上資格條件（育兒津貼需要聲明遷徙）。模型不能改條件。";
  }
  if (result.catalog.length > 0) {
    return "目錄有對應項目，都標記為不可發票。不能發明 purpose。";
  }
  return `目錄沒有對應目的。可搜尋的登記項包含育兒津貼、冷氣補助、水災救助。快樂路徑：「${HAPPY_PATH_UTTERANCE}」`;
}

export function evaluateInquiry(utterance: string, today: string): InquiryResult {
  const message = utterance.trim();
  const topics = topicsFromUtterance(message);
  const catalog = searchCatalog(message).map(catalogPublic);
  const situation = situationFromUtterance(message, today);
  const programs = situation ? matchPrograms(situation) : [];
  const partial = {
    utterance: message,
    topics,
    situation,
    programs,
    catalog,
    canIssue: programs.length > 0,
  };
  return { ...partial, closeReason: closeReasonFor(partial) };
}

function programLines(programs: ProgramPlan[]): string[] {
  return programs.flatMap((program, index) => {
    const purpose = PURPOSES[program.purpose];
    const lines = [
      `${index + 1}. ${program.title} — ${program.agencyName}`,
      `   原因：${program.reasons.join("；")}`,
      `   本匣述詞：${program.claims.map((id) => CLAIM_DEFS[id].label).join("、")}`,
      `   法定依據：${purpose.legalBasis[0]}`,
    ];
    if (program.hint) lines.push(`   提示：${program.hint}`);
    return lines;
  });
}

function catalogLines(catalog: CatalogPublic[]): string[] {
  return catalog.flatMap((entry, index) => {
    const status = entry.issuable ? "可發票（仍要過規則引擎）" : "參考列出，不可發票";
    const lines = [
      `${index + 1}. ${entry.title} — ${entry.agencyName}`,
      `   ${status}`,
      `   ${entry.summary}`,
    ];
    if (entry.requiredPredicates.length > 0) {
      lines.push(`   需要的述詞：${entry.requiredPredicates.join("、")}`);
    }
    if (entry.missing.length > 0) {
      lines.push(`   缺什麼：${entry.missing.join("；")}`);
    }
    return lines;
  });
}

export function formatInquiryMessage(result: InquiryResult, today: string): string {
  const hint = ageHint(childAgeMonthsAt(today));
  if (result.canIssue) {
    return [
      "規則引擎比對結果（非模型授權）：",
      programLines(result.programs).join("\n"),
      hint,
      AGENT_NOTES.join("\n"),
    ].join("\n\n");
  }

  return [
    "目錄搜尋結果（只搜本部署登記表，不是外網，也不是授權）：",
    result.catalog.length > 0 ? catalogLines(result.catalog).join("\n") : "（沒有命中）",
    result.closeReason,
    `若要發票，快樂路徑仍是：「${HAPPY_PATH_UTTERANCE}」。水災例句：「${FLOOD_UTTERANCE}」只會搜到參考項。`,
    AGENT_NOTES.join("\n"),
  ].join("\n\n");
}

export function inquiryPayload(result: InquiryResult, extraNotes: string[] = []) {
  return {
    ok: result.canIssue || result.catalog.length > 0,
    canIssue: result.canIssue,
    topics: result.topics,
    closeReason: result.closeReason,
    programs: result.programs.map((program) => ({
      grantId: program.grantId,
      title: program.title,
      purpose: program.purpose,
      agency: program.agencyId,
      agencyName: program.agencyName,
      reasons: program.reasons,
      claimIds: program.claims,
      claimLabels: program.claims.map((id) => CLAIM_DEFS[id].label),
      legalBasis: PURPOSES[program.purpose].legalBasis,
      hint: program.hint,
    })),
    catalog: result.catalog,
    notes: [...AGENT_NOTES, ...extraNotes],
  };
}
