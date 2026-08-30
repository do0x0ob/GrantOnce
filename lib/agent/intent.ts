import OpenAI from "openai";
import type { Intent } from "./turn";

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
const INTENTS = ["apply", "status", "audit", "privacy", "revoke", "help"] as const;

export type Classification = {
  intent: Intent;
  /** Whether the speaker described a recent move. The rule engine decides what
   *  that means; this only reports what was said. */
  movedRecently: boolean;
};

const SYSTEM = `你是一個意圖分類器，唯一的工作是把使用者的話對應到下列標籤之一。

apply    想知道自己能申請什麼補助，或描述了生活狀況的變動
status   想知道現有申請案的進度
audit    想知道誰在什麼時候取用過自己的資料
privacy  想知道機關會拿到哪些資料，或擔心某類資料外流
revoke   想撤銷、取消或停止授權
help     想知道你會做什麼、怎麼用

只輸出一行 JSON，不要有其他文字，不要 markdown 圍欄：
{"intent":"<標籤>","movedRecently":<true 或 false>}

movedRecently 只在使用者提到搬家、遷徙、遷入、換住址時為 true。
無法對應到任何標籤時，intent 用 "help"。`;

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
    return { intent: intent as Intent, movedRecently: value.movedRecently === true };
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
    const client = new OpenAI({ baseURL, apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
    const response = await client.chat.completions.create({
      model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
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
