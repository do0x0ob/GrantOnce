/**
 * Open-world program research. This is not authorization.
 *
 * The purpose registry is the issuance ceiling — what this runtime can bind
 * into a Grant. It is not a model of the real world. The model (or this
 * helper) may look up anything public; only minting stay fail-closed.
 */

export type ResearchFinding = {
  title: string;
  url: string;
  snippet: string;
  publisher: string;
};

export type ResearchResult = {
  query: string;
  source: "live" | "unavailable" | "disabled";
  findings: ResearchFinding[];
  note: string;
};

const UA = "GrantOnce/0.1 (research; https://github.com/do0x0ob/GrantOnce)";
const TIMEOUT_MS = 8_000;
const CACHE_MS = 5 * 60_000;
const NOTE =
  "這些是公開資料，只供查找方案；不代表符合資格，也不會建立授權。只有已完成系統綁定的方案才能進入申請流程。";

const cache = new Map<string, { at: number; result: ResearchResult }>();

type ResearchFn = (query: string) => Promise<ResearchResult>;
let override: ResearchFn | null = null;

export function setResearchForTests(fn: ResearchFn | null) {
  override = fn;
}

export function clearResearchCache() {
  cache.clear();
}

function disabled(query: string): ResearchResult {
  return { query, source: "disabled", findings: [], note: NOTE };
}

function unavailable(query: string, reason: string): ResearchResult {
  return {
    query,
    source: "unavailable",
    findings: [],
    note: `${NOTE} 這次公開搜尋沒有成功（${reason}）。宿主若有自己的網搜，請用那個。`,
  };
}

function allowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (
    host === "zh.wikipedia.org" ||
    host.endsWith(".wikipedia.org") ||
    host.endsWith(".wikimedia.org") ||
    host === "gov.tw" ||
    host.endsWith(".gov.tw")
  ) {
    return url;
  }
  return null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchOk(url: string): Promise<Response> {
  const parsed = allowedUrl(url);
  if (!parsed) throw new Error(`blocked url: ${url}`);
  const res = await fetch(parsed, {
    headers: { "user-agent": UA, accept: "application/json, text/html;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.url && !allowedUrl(res.url)) throw new Error(`redirect left allowlist: ${res.url}`);
  return res;
}

async function wikiSearch(term: string): Promise<{ title: string; snippet: string; pageid: number }[]> {
  const api = new URL("https://zh.wikipedia.org/w/api.php");
  api.searchParams.set("action", "query");
  api.searchParams.set("list", "search");
  api.searchParams.set("srsearch", term);
  api.searchParams.set("srlimit", "5");
  api.searchParams.set("format", "json");
  api.searchParams.set("utf8", "1");
  const res = await fetchOk(api.toString());
  const json = (await res.json()) as {
    query?: { search?: { title: string; snippet: string; pageid: number }[] };
  };
  return json.query?.search ?? [];
}

async function wikiPages(pageids: number[]): Promise<ResearchFinding[]> {
  if (pageids.length === 0) return [];
  const api = new URL("https://zh.wikipedia.org/w/api.php");
  api.searchParams.set("action", "query");
  api.searchParams.set("prop", "extracts|info|extlinks");
  api.searchParams.set("exintro", "1");
  api.searchParams.set("explaintext", "1");
  api.searchParams.set("inprop", "url");
  api.searchParams.set("ellimit", "20");
  api.searchParams.set("pageids", pageids.slice(0, 4).join("|"));
  api.searchParams.set("format", "json");
  api.searchParams.set("utf8", "1");
  const res = await fetchOk(api.toString());
  const json = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          extract?: string;
          fullurl?: string;
          extlinks?: { "*": string }[];
        }
      >;
    };
  };
  const findings: ResearchFinding[] = [];
  for (const page of Object.values(json.query?.pages ?? {})) {
    if (!page.title || !page.fullurl) continue;
    findings.push({
      title: page.title,
      url: page.fullurl,
      snippet: (page.extract ?? "").trim().slice(0, 280),
      publisher: "維基百科",
    });
    for (const link of page.extlinks ?? []) {
      const href = link["*"]?.startsWith("//") ? `https:${link["*"]}` : link["*"];
      if (!href || !allowedUrl(href) || !/\.gov\.tw$/i.test(new URL(href).hostname)) continue;
      findings.push({
        title: `${page.title}（政府連結）`,
        url: href,
        snippet: "維基條目列出的政府網域連結。內文需點進去看，這裡不假裝已核定資格。",
        publisher: new URL(href).hostname,
      });
    }
  }
  return findings;
}

function termsFor(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const cleaned = q
    .replace(/[嗎呢吧呀啊？?。，,！!]/g, " ")
    .replace(/我最近|我剛|可以申請什麼|可以申請|申請什麼|有什麼|看我能/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hinted = /水災|淹水|洪水|受災|風災/.test(q)
    ? ["災害救助金", "社會救助", "水災慰助"]
    : /育兒|托育/.test(q)
      ? ["臺灣 育兒津貼"]
      : /冷氣|節能/.test(q)
        ? ["臺灣 住宅節能補助"]
        : [];
  const terms = [...hinted];
  if (q.length <= 16) terms.unshift(q);
  else if (cleaned && !hinted.length) terms.push(cleaned);
  if (!hinted.length && cleaned && !/台灣|臺灣/.test(cleaned)) terms.push(`${cleaned} 臺灣`);
  return [...new Set(terms)].slice(0, 3);
}

function relevance(text: string, query: string): number {
  let score = 0;
  for (const [keyword, weight] of [
    ["災害救助", 8],
    ["救助金", 6],
    ["慰助", 5],
    ["水災", 5],
    ["社會救助", 8],
    ["育兒津貼", 5],
    ["補助", 2],
    ["補貼", 2],
    ["津貼", 2],
    ["福利", 1],
    ["方案", 1],
    ["計畫", 1],
    ["辦法", 1],
  ] as const) {
    if (text.includes(keyword)) score += weight;
  }

  const topicKeywords = /水災|淹水|洪水|受災|風災/.test(query)
    ? ["水災", "洪水", "災害", "救助", "慰助"]
    : /育兒|托育|幼兒|小孩|孩子/.test(query)
      ? ["育兒", "托育", "幼兒", "兒童"]
      : /冷氣|空調|節能/.test(query)
        ? ["冷氣", "空調", "節能"]
        : /搬家|遷入|遷徙|遷居/.test(query)
          ? ["搬家", "遷入", "遷居", "住宅"]
          : [];
  for (const keyword of topicKeywords) {
    if (text.includes(keyword)) score += 4;
  }
  return score;
}

export function isRelevantProgramTitle(title: string, query: string): boolean {
  if (!/補助|補貼|津貼|救助金|慰助|社會救助|災害救助|福利|方案|計畫|辦法/.test(title)) {
    return false;
  }
  return relevance(title, query) > 0;
}

function dedupe(findings: ResearchFinding[]): ResearchFinding[] {
  const seen = new Set<string>();
  const out: ResearchFinding[] = [];
  for (const item of findings) {
    const key = item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!item.snippet && !item.title) continue;
    out.push(item);
    if (out.length >= 3) break;
  }
  return out;
}

async function liveResearch(query: string): Promise<ResearchResult> {
  const terms = termsFor(query);
  if (terms.length === 0) {
    return { query, source: "live", findings: [], note: NOTE };
  }

  const hits: { title: string; snippet: string; pageid: number }[] = [];
  const errors: string[] = [];
  let completedSearches = 0;
  for (const term of terms) {
    try {
      hits.push(...(await wikiSearch(term)));
      completedSearches += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const ranked = [...hits]
    .map((hit) => ({ hit, score: relevance(`${hit.title} ${hit.snippet}`, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ hit }) => hit);
  const uniqueIds = [...new Set(ranked.map((h) => h.pageid))];
  if (uniqueIds.length === 0) {
    if (completedSearches > 0) {
      return { query, source: "live", findings: [], note: NOTE };
    }
    return unavailable(query, errors[0] ?? "沒有足夠相關的公開條目");
  }

  try {
    const fromPages = await wikiPages(uniqueIds);
    const fromSearch = ranked.map((hit) => ({
      title: hit.title,
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
      snippet: stripTags(hit.snippet).slice(0, 220),
      publisher: "維基百科",
    }));
    const findings = dedupe(
      [...fromPages, ...fromSearch]
        .filter((item) => isRelevantProgramTitle(item.title, query))
        .sort(
        (a, b) =>
          relevance(`${b.title} ${b.snippet}`, query) -
          relevance(`${a.title} ${a.snippet}`, query),
        ),
    );
    return { query, source: "live", findings, note: NOTE };
  } catch (error) {
    const fallback = dedupe(
      ranked
        .map((hit) => ({
          title: hit.title,
          url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
          snippet: stripTags(hit.snippet).slice(0, 220),
          publisher: "維基百科",
        }))
        .filter((item) => isRelevantProgramTitle(item.title, query)),
    );
    if (fallback.length > 0) return { query, source: "live", findings: fallback, note: NOTE };
    return unavailable(query, error instanceof Error ? error.message : String(error));
  }
}

export async function researchWorld(query: string): Promise<ResearchResult> {
  const q = query.trim();
  if (process.env.GRANTONCE_RESEARCH === "0") return disabled(q);
  if (override) return override(q);

  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;

  const result = await liveResearch(q);
  cache.set(q, { at: Date.now(), result });
  return result;
}

export function formatResearchLines(research: ResearchResult): string[] {
  if (research.source === "disabled") {
    return ["公開搜尋目前未啟用；系統內建方案不代表所有可申請的補助。"];
  }
  if (research.findings.length === 0) {
    return [
      `公開搜尋沒有可用結果（${research.source}）。`,
      "這不表示世界上沒有對應補助，只表示這次沒抓到公開頁。",
    ];
  }
  return [
    "公開找到的方案（僅供查找，不代表符合資格）：",
    ...research.findings.flatMap((item, index) => [
      `${index + 1}. ${item.title} — ${item.publisher}`,
      `   ${item.snippet || "（無摘要）"}`,
      `   ${item.url}`,
    ]),
  ];
}
