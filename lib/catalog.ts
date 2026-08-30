import { PURPOSES, type PurposeDef, type PurposeId } from "./purposes";
import type { AgencyId } from "./types";

/**
 * Issuable profile for THIS runtime — not a model of the real world.
 * Open-world lookup lives in `research.ts`. A row here only answers
 * "can we mint a Grant?", never "does this subsidy exist?".
 */
export const TOPIC_IDS = ["flood", "move", "childcare", "aircon", "general"] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

const TOPIC_PATTERNS: Record<TopicId, RegExp> = {
  flood: /水災|淹水|洪水|豪雨|風災|颱風|受災|災害救助|災民|flood/,
  move: /搬家|遷徙|剛搬|搬到|遷入/,
  childcare: /育兒|托育|幼兒津貼|childcare/,
  aircon: /冷氣|節能|汰換|用電補助|aircon/,
  general: /申請|補助|津貼|能申|可以申|有什麼|看我能/,
};

export const FLOOD_UTTERANCE = "我最近遭水災可以申請什麼補助嗎";

export type CatalogEntry = {
  id: string;
  title: string;
  summary: string;
  agencyName: string;
  agencyId: AgencyId | null;
  purposeId: PurposeId | null;
  issuable: boolean;
  topics: TopicId[];
  keywords: string[];
  requiredPredicates: string[];
  missing: string[];
};

export const PURPOSE_CATALOG: readonly CatalogEntry[] = [
  {
    id: "childcare-allowance",
    title: PURPOSES["childcare-allowance"].title,
    summary: "遷入新北市且幼兒落在 0–2 歲帶時可發票。匣內只有述詞。",
    agencyName: PURPOSES["childcare-allowance"].agencyName,
    agencyId: PURPOSES["childcare-allowance"].agency,
    purposeId: "childcare-allowance",
    issuable: true,
    topics: ["childcare", "move"],
    keywords: ["育兒", "托育", "津貼", "幼兒", "社會局"],
    requiredPredicates: [...PURPOSES["childcare-allowance"].allowedClaims],
    missing: [],
  },
  {
    id: "aircon-subsidy",
    title: PURPOSES["aircon-subsidy"].title,
    summary: "有住宅用電戶時可發票。用電級距與成對假名，不是電號。",
    agencyName: PURPOSES["aircon-subsidy"].agencyName,
    agencyId: PURPOSES["aircon-subsidy"].agency,
    purposeId: "aircon-subsidy",
    issuable: true,
    topics: ["aircon", "move"],
    keywords: ["冷氣", "節能", "汰換", "台電", "用電"],
    requiredPredicates: [...PURPOSES["aircon-subsidy"].allowedClaims],
    missing: [],
  },
  {
    id: "flood-relief",
    title: "水災災害救助／慰助金",
    summary: "參考列出。本部署沒有受災列、沒有 disaster.* 述詞、沒有查核 adapter。",
    agencyName: "鄉鎮公所／直轄市社會局（災害救助）",
    agencyId: null,
    purposeId: null,
    issuable: false,
    topics: ["flood"],
    keywords: ["水災", "淹水", "洪水", "豪雨", "風災", "受災", "災害救助", "慰助金"],
    requiredPredicates: ["disaster.floodVictim", "disaster.lossBand"],
    missing: [
      "目的登記表沒有 flood-relief",
      "金庫沒有受災列，沒有 disaster.* 述詞",
      "沒有災害查核的 issuer adapter",
    ],
  },
  {
    id: "rent-subsidy",
    title: "住宅租金補貼",
    summary: "參考列出。沒有租約或所得述詞，不能發票。",
    agencyName: "內政部國土管理署",
    agencyId: null,
    purposeId: null,
    issuable: false,
    topics: ["general"],
    keywords: ["租金", "租屋", "房租", "住宅補貼"],
    requiredPredicates: ["housing.renter", "income.band"],
    missing: ["目的登記表沒有 rent-subsidy", "金庫沒有租約或所得級距述詞"],
  },
  {
    id: "unemployment-benefit",
    title: "失業給付",
    summary: "參考列出。沒有勞保／就業述詞，不能發票。",
    agencyName: "勞動部勞工保險局",
    agencyId: null,
    purposeId: null,
    issuable: false,
    topics: ["general"],
    keywords: ["失業", "就業保險", "失業給付"],
    requiredPredicates: ["labor.insured", "labor.unemployed"],
    missing: ["目的登記表沒有 unemployment-benefit", "金庫沒有勞保就業列"],
  },
];

export function compactText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function topicsFromUtterance(utterance: string): TopicId[] {
  const t = compactText(utterance);
  return TOPIC_IDS.filter((id) => TOPIC_PATTERNS[id].test(t));
}

function sortCatalog(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) => Number(b.issuable) - Number(a.issuable));
}

function entryFromPurpose(def: PurposeDef): CatalogEntry {
  return {
    id: def.id,
    title: def.title,
    summary: `登記台上的目的。匣內述詞：${def.allowedClaims.join("、")}。`,
    agencyName: def.agencyName,
    agencyId: def.agency,
    purposeId: def.id,
    issuable: true,
    topics: ["general"],
    keywords: [def.title, def.id],
    requiredPredicates: [...def.allowedClaims],
    missing: [],
  };
}

function activeCatalog(liveDefs: PurposeDef[] = Object.values(PURPOSES)): CatalogEntry[] {
  const live = liveDefs.map(entryFromPurpose);
  const refs = PURPOSE_CATALOG.filter((entry) => !live.some((row) => row.id === entry.id));
  return [...live, ...refs];
}

/** Filter the issuable profile. Not a web search. */
export function searchCatalog(query: string, liveDefs?: PurposeDef[]): CatalogEntry[] {
  const catalog = activeCatalog(liveDefs);
  const t = compactText(query);
  if (!t) return sortCatalog(catalog);

  const topics = topicsFromUtterance(query);
  const specific = topics.filter((topic) => topic !== "general");

  const hits = catalog.filter((entry) => {
    if (specific.some((topic) => entry.topics.includes(topic))) return true;
    const hay = compactText(
      [entry.id, entry.title, entry.summary, entry.agencyName, ...entry.keywords].join(""),
    );
    if (hay.includes(t)) return true;
    return entry.keywords.some((keyword) => {
      const k = compactText(keyword);
      return k.length > 0 && (t.includes(k) || k.includes(t));
    });
  });

  if (hits.length > 0) return sortCatalog(hits);
  if (topics.includes("general")) return sortCatalog(catalog);
  return [];
}

export function catalogPublic(entry: CatalogEntry) {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    agencyName: entry.agencyName,
    purposeId: entry.purposeId,
    issuable: entry.issuable,
    requiredPredicates: entry.requiredPredicates,
    missing: entry.missing,
  };
}

export type CatalogPublic = ReturnType<typeof catalogPublic>;
