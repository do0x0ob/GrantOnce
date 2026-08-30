import OpenAI from "openai";
import { PURPOSES } from "@/lib/purposes";

export type Intent = "apply" | "status" | "audit" | "privacy" | "revoke" | "help";

/**
 * The model's entire job: report what was said.
 *
 * It never sees the vault, never chooses claims, and never decides who
 * qualifies for anything — the rule engine and the purpose registry still do
 * all of that. Widening this function's return type is the line to guard: the
 * moment a model can influence *what* is asked for rather than *what was
 * meant*, the project's claim that a rule engine decides authorisation stops
 * being true.
 *
 * Talks to an OpenAI-compatible router (clawrouter). Deliberately does not use
 * JSON-schema `response_format`: those routers reject it for several upstream
 * models. Asking for one line and validating it here is both simpler and the
 * thing that actually works across them.
 */
const INTENTS = ["apply", "status", "audit", "privacy", "revoke", "help"] as const;

export type Classification = {
  intent: Intent;
  /** Whether the speaker described a recent move. The rule engine decides what
   *  that means; this only reports what was said. */
  movedRecently: boolean;
  /**
   * Purpose ids the speaker named. `null` / omitted means they did not name
   * one (list everything eligible). An array — even empty after unknown ids
   * are dropped — means they named something, so do not mint the rest.
   */
  asked?: string[] | null;
  /**
   * One sentence acknowledging what was actually said, rendered above the
   * factual cards. Prose only: it cannot change which claims are requested or
   * what the cards state, and it is dropped entirely if it fails validation —
   * the templated content stands on its own either way.
   */
  reply?: string;
};

function purposeCatalog(): string {
  return Object.values(PURPOSES)
    .map((p) => `- ${p.id}（${p.title}）`)
    .join("\n");
}

function systemPrompt(): string {
  return `你是一個意圖分類器，唯一的工作是把使用者的話對應到下列標籤之一，並標出他們有沒有指名特定補助。

apply    想知道自己能申請什麼補助，或描述了生活狀況的變動
status   想知道現有申請案的進度
audit    想知道誰在什麼時候取用過自己的資料
privacy  想知道機關會拿到哪些資料，或擔心某類資料外流
revoke   想撤銷、取消或停止授權
help     想知道你會做什麼、怎麼用

可用的目的 id（asked 只能填這些，不能發明）：
${purposeCatalog()}

另外寫一句話回應對方實際說的內容，接在系統的說明之前。規則：

- 一句話，四十個字以內，繁體中文
- 回應他說的那件事，不要複述標籤
- **絕對不要宣稱任何動作已經完成**（已送出、已核准、已簽署、已申請、已取得…都不行）
- 不要承諾結果，不要說會不會過
- 系統會在你這句話下面附上正確的資料，你不需要自己列

只輸出一行 JSON，不要有其他文字，不要 markdown 圍欄：
{"intent":"<標籤>","movedRecently":<true 或 false>,"asked":<null 或 ["目的id"]>,"reply":"<一句話>"}

movedRecently 只在使用者提到搬家、遷徙、遷入、換住址時為 true。
沒有指名特定補助時 asked 用 null（例如「我剛搬家，看我能申請什麼」）。
指名了某一項時 asked 只放那一項的 id（「要搞育兒津貼」→ ["childcare-allowance"]）。
指名了但不在清單裡時 asked 用 []。
無法對應到任何標籤時，intent 用 "help"，asked 用 null。`;
}

// Reasoning models spend this budget thinking before they answer, so a
// classifier ceiling sized for one line of JSON leaves nothing for the line —
// the reply comes back with finish_reason "length" and empty content.
const MAX_TOKENS = 1024;

const TIMEOUT_MS = 10_000;

/**
 * Read per call, not at module scope. Module-level capture binds whatever the
 * environment happened to be when the import was first evaluated, which is
 * before anything that loads a dotenv file at runtime gets a chance to run.
 */
function config() {
  const baseURL = process.env.AGENT_MODEL_BASE_URL?.trim();
  const apiKey = process.env.AGENT_MODEL_API_KEY?.trim();
  return {
    baseURL,
    apiKey,
    model: process.env.AGENT_MODEL?.trim() || "claude-opus-5",
    configured: Boolean(baseURL && apiKey),
  };
}

/** Present only when a router is configured. */
export function modelAvailable(): boolean {
  return config().configured;
}

/**
 * Wording that would assert something happened. A demo shown to a government
 * audience must not have its agent claim an application was filed, and a model
 * writing free prose will eventually reach for those verbs — so the sentence is
 * dropped rather than trusted.
 */
const FORBIDDEN = /已(經)?(送出|送件|核准|通過|完成|簽署|申請|取得|兌現|辦好)|幫你(送|申請|簽)/;

/** Exported so the guard can be tested without a router in the loop. */
export function cleanReply(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || text.length > 60) return undefined;
  if (FORBIDDEN.test(text)) return undefined;
  return text;
}

function parseAsked(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function parse(raw: string): Classification | null {
  // Some routers inline the reasoning ahead of the answer and some wrap it in a
  // fence, so take the last balanced object rather than assuming the whole
  // string is the JSON.
  const match = raw.match(/\{[^{}]*\}(?![\s\S]*\{[^{}]*\})/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[0]) as Record<string, unknown>;
    const intent = value.intent;
    if (typeof intent !== "string") return null;
    if (!(INTENTS as readonly string[]).includes(intent)) return null;
    return {
      intent: intent as Intent,
      movedRecently: value.movedRecently === true,
      asked: parseAsked(value.asked),
      reply: cleanReply(value.reply),
    };
  } catch {
    return null;
  }
}

/**
 * Returns null on anything unexpected — no router, a timeout, an unparseable
 * reply, a label outside the enum. The conversation path does not fall back to
 * keyword matching: a null here is "not understood".
 */
export async function classify(utterance: string): Promise<Classification | null> {
  const { baseURL, apiKey, model, configured } = config();
  if (!configured) return null;

  try {
    const client = new OpenAI({ baseURL, apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
    const response = await client.chat.completions.create({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt() },
        { role: "user", content: utterance },
      ],
    });
    const text = response.choices[0]?.message?.content;
    return typeof text === "string" ? parse(text) : null;
  } catch {
    // A classifier that can fail the request is worse than no classifier.
    return null;
  }
}
