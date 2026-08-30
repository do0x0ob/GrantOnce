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
import { livePurposes } from "./registry-io";
import { formatResearchLines, type ResearchResult } from "./research";
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
    return "真實世界有災害救助／慰助金。本 runtime 還沒有受災述詞與 issuer adapter，所以不能 mint Grant——缺的是綁定，不是世界上沒有這筆補助。";
  }
  if (result.catalog.some((entry) => entry.issuable)) {
    return "本 runtime 有對得上的可發票目的，但這句話還沒對上資格條件（育兒津貼需要聲明遷徙）。模型不能改條件。";
  }
  if (result.catalog.length > 0) {
    return "公開資料可能有對應補助；本 runtime 對這些目的還沒有 issuer adapter，不能發明 purpose 來發票。";
  }
  return "公開搜尋與發票是兩件事。沒有可發票的綁定時不能 mint Grant，但仍然可以說明真實世界有什麼。";
}

export function evaluateInquiry(utterance: string, today: string): InquiryResult {
  const message = utterance.trim();
  const topics = topicsFromUtterance(message);
  const catalog = searchCatalog(message, Object.values(livePurposes())).map(catalogPublic);
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

export function formatInquiryMessage(
  result: InquiryResult,
  today: string,
  research?: ResearchResult,
): string {
  const hint = ageHint(childAgeMonthsAt(today));
  const world = research ? formatResearchLines(research).join("\n") : "";
  const issuance = result.canIssue
    ? ["規則引擎比對結果（這才是授權提案，不是搜尋）：", programLines(result.programs).join("\n"), hint]
    : [
        "本 runtime 目前能 mint Grant 的目的：",
        result.catalog.length > 0 ? catalogLines(result.catalog).join("\n") : "（沒有對上可發票的綁定）",
        result.closeReason,
        `若要走已綁定的搬家路徑：「${HAPPY_PATH_UTTERANCE}」。問「${FLOOD_UTTERANCE}」會先搜真實世界，不會假裝世界上只有育兒與冷氣。`,
      ];

  return [world, issuance.join("\n\n"), AGENT_NOTES.join("\n")].filter(Boolean).join("\n\n");
}

export function inquiryPayload(
  result: InquiryResult,
  extraNotes: string[] = [],
  research?: ResearchResult,
) {
  return {
    ok: true,
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
    issuable: result.catalog,
    world: research ?? null,
    notes: [...AGENT_NOTES, ...extraNotes],
  };
}
