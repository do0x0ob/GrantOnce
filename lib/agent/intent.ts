import OpenAI from "openai";
import {
  agentSkillsPrompt,
  isAgentSkillAction,
  isAgentSkillId,
  type AgentSkillAction,
  type AgentSkillId,
} from "./skills";
import { effectiveToday, matchPrograms } from "@/lib/rules";
import type { DemoState } from "@/lib/types";
import { patternIntent, situationFor, type Intent } from "./turn";

/**
 * The model's entire job: map free text onto one of six labels.
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
const INTENTS = [
  "apply",
  "request",
  "confirm",
  "decline",
  "status",
  "audit",
  "privacy",
  "revoke",
  "help",
] as const;

export type Classification = {
  intent: Intent;
  /** Optional local playbook. It can choose how to help, never what claims exist. */
  skill?: AgentSkillId;
  skillAction?: AgentSkillAction;
  /** Whether the speaker described a recent move. The rule engine decides what
   *  that means; this only reports what was said. */
  movedRecently: boolean;
  /**
   * One sentence acknowledging what was actually said, rendered above the
   * factual cards. Prose only: it cannot change which claims are requested or
   * what the cards state, and it is dropped entirely if it fails validation —
   * the templated content stands on its own either way.
   */
  reply?: string;
};

/** Known non-application commands are clearer and faster through fixed rules. */
export function shouldClassifyForChat(utterance: string): boolean {
  const patterned = patternIntent(utterance);
  return patterned === null || patterned === "apply";
}

/** Public research is useful for benefit discovery, not for every chat turn. */
export function shouldResearchForChat(
  utterance: string,
  resolved: Classification | null,
): boolean {
  if (resolved?.skill === "apply-with-grant" && resolved.skillAction === "clarify") {
    return false;
  }

  const patterned = patternIntent(utterance);
  if (patterned && patterned !== "apply") {
    return false;
  }

  return (resolved?.intent ?? patterned) === "apply";
}

/**
 * Whether a public search is worth spending on this sentence.
 *
 * The registry is asked first: public search exists to say 「這個世界上有，但本
 * 系統還沒綁定」, which is only informative when the registry came back empty.
 * Running it regardless put a Wikipedia disambiguation page above the answer for
 * 「要搞育兒津貼」, a service registered right here.
 */
export function shouldResearch(
  state: DemoState,
  message: string,
  resolved: { intent: Intent; movedRecently: boolean } | null,
): boolean {
  if (!shouldResearchForChat(message, resolved)) return false;
  const situation = situationFor(message, effectiveToday(state), resolved?.movedRecently ?? null);
  return matchPrograms(situation).length === 0;
}


const SYSTEM = `你是 GrantOnce 的語言理解層。先判斷是否有一個 local skill 適用，再把使用者的話對應到下列標籤之一。

apply    想知道自己能申請什麼補助，或描述了生活狀況的變動
request  決定要辦名單上的某一項服務（「我要辦育兒津貼」「就辦這個」）
confirm  看過該服務要的資料後同意往下走（「確認」「就這樣」「繼續」）
decline  看過之後不想辦了（「先不要」「算了」「不用了」）
status   想知道現有申請案的進度
audit    想知道誰在什麼時候取用過自己的資料
privacy  想知道機關會拿到哪些資料，或擔心某類資料外流
revoke   想撤銷、取消或停止授權
help     想知道你會做什麼、怎麼用

可用的 local skills 會附在下方。skill 只決定怎麼協助，不得改變資格、述詞、目的、受眾或法源。
使用 apply-with-grant 時，還要依照 skill 的規則選 skillAction：explain、clarify 或 plan。

另外寫一句話回應對方實際說的內容，接在系統的說明之前。規則：

- 一句話，四十個字以內，繁體中文
- 回應他說的那件事，不要複述標籤
- **絕對不要宣稱任何動作已經完成**（已送出、已核准、已簽署、已申請、已取得…都不行）
- 不要承諾結果，不要說會不會過
- 系統會在你這句話下面附上正確的資料，你不需要自己列

只輸出一行 JSON，不要有其他文字，不要 markdown 圍欄：
{"intent":"<標籤>","skill":"<skill 名稱或 null>","skillAction":"<動作或 null>","movedRecently":<true 或 false>,"reply":"<一句話>"}

movedRecently 只在使用者提到搬家、遷徙、遷入、換住址時為 true。
confirm 只表示「同意往下走」，不表示同意簽署；系統仍會先做目的與法源檢查，再由本人簽章。
無法對應到任何標籤時，intent 用 "help"。

## Local skills
`;

// Reasoning models spend this budget thinking before they answer, so a
// classifier ceiling sized for one line of JSON leaves nothing for the line —
// the reply comes back with finish_reason "length" and empty content.
const MAX_TOKENS = 1024;

// Only ever paid when the patterns already missed, so it can be generous.
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

/** Present only when a router is configured; otherwise the deterministic
 *  patterns handle everything and behaviour is identical. */
export function modelAvailable(): boolean {
  return config().configured;
}

/**
 * Wording that would assert something happened. A demo shown to a government
 * audience must not have its agent claim an application was filed, and a model
 * writing free prose will eventually reach for exactly those verbs — so the
 * sentence is dropped rather than trusted.
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
    const skill = isAgentSkillId(value.skill) ? value.skill : undefined;
    const skillAction = skill && isAgentSkillAction(value.skillAction)
      ? value.skillAction
      : undefined;
    return {
      intent: intent as Intent,
      skill: skillAction ? skill : undefined,
      skillAction,
      movedRecently: value.movedRecently === true,
      reply: cleanReply(value.reply),
    };
  } catch {
    return null;
  }
}

/**
 * Returns null on anything unexpected — no router, a timeout, an unparseable
 * reply, a label outside the enum. Every null falls through to the patterns, so
 * removing the credentials changes nothing about how the demo behaves.
 */
export async function classify(utterance: string): Promise<Classification | null> {
  const { baseURL, apiKey, model, configured } = config();
  if (!configured) return null;

  try {
    const system = `${SYSTEM}\n\n${agentSkillsPrompt()}`;
    const client = new OpenAI({ baseURL, apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
    const response = await client.chat.completions.create({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: system },
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
