import { CLAIM_DEFS, SENSITIVITY_LABEL, SPECIAL_CLAIMS } from "@/lib/claims";
import { PURPOSE_IDS, PURPOSES } from "@/lib/purposes";
import {
  ageHint,
  childAgeMonthsAt,
  effectiveToday,
  HAPPY_PATH_UTTERANCE,
  matchPrograms,
  PERSONA_DECLARED,
  situationFromUtterance,
} from "@/lib/rules";
import type { DemoState, ProgramPlan } from "@/lib/types";
import { toBlocks } from "./blocks/of";
import type { Block } from "./blocks/types";

/**
 * One turn of the agent, as tool output.
 *
 * The web route and the MCP server both call this, so the reply can no longer
 * drift between them — previously each built its own copy of the same sentences.
 * It returns raw objects rather than blocks so the matcher layer stays the only
 * thing that decides what becomes a card.
 */
export type TurnResult = {
  /** Programmes the rule engine matched; the caller proposes grants from these. */
  programs: ProgramPlan[];
  /** Untyped tool output, in reading order. */
  outputs: unknown[];
  matched: boolean;
};

/** Vault groups the matched programmes deliberately never ask for. */
function withheldFrom(programs: ProgramPlan[]): string[] {
  const asked = new Set(programs.flatMap((p) => p.claims));
  const groups = new Set<string>();
  for (const [claimId, def] of Object.entries(CLAIM_DEFS)) {
    if (asked.has(claimId as never)) continue;
    if (def.sensitivity === "predicate" || def.sensitivity === "pseudonym") continue;
    groups.add(def.label);
  }
  return [...groups];
}

/**
 * What the agent understands.
 *
 * Deterministic intent matching rather than a model: the demo's whole claim is
 * that a rule engine decides eligibility, so putting a model in this loop would
 * undercut it. The cost is that the vocabulary is finite — which is why an
 * unrecognised question answers with buttons instead of an apology.
 */
export type Intent = "apply" | "status" | "audit" | "privacy" | "revoke" | "help";

const INTENT_VALUES: Intent[] = ["apply", "status", "audit", "privacy", "revoke", "help"];

const INTENT_PATTERNS: [Intent, RegExp][] = [
  ["status", /進度|到哪|辦得?怎麼樣|狀態|審核|送出了嗎|好了沒/],
  ["audit", /誰.*(拿|取|看|調)|稽核|紀錄|軌跡|查詢紀錄/],
  ["privacy", /所得|隱私|會拿到什麼|給什麼|哪些資料|個資|安全|健保/],
  ["revoke", /撤銷|取消|停止|不要了|收回/],
  ["apply", /搬家|遷徙|剛搬|搬到|遷入|申請|補助|津貼|能申|可以申|辦什麼/],
  ["help", /你會|能做什麼|怎麼用|說明|幫助|help/],
];

function intentOf(utterance: string): Intent | null {
  const t = utterance.replace(/\s+/g, "");
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(t)) return intent;
  }
  return null;
}

const MENU = {
  suggestions: [
    { label: "我剛搬家，看我能申請什麼", utterance: HAPPY_PATH_UTTERANCE },
    { label: "機關會拿到我哪些資料？", utterance: "機關會拿到我哪些資料？" },
    { label: "我的申請到哪了？", utterance: "我的申請到哪了？" },
    { label: "誰拿過我的資料？", utterance: "誰拿過我的資料？" },
    { label: "我要停止委託", utterance: "我要停止委託" },
  ],
};

/** What every registered purpose would receive, and what is withheld and why. */
function claimsExplainer() {
  return {
    purposes: PURPOSE_IDS.map((id) => ({
      purpose: id,
      title: PURPOSES[id].title,
      claims: PURPOSES[id].allowedClaims.map((c) => ({
        label: CLAIM_DEFS[c].label,
        shape: CLAIM_DEFS[c].shape,
      })),
    })),
    // PR #10 gives each withheld claim its own legal ground; until that lands
    // this states the tier, which is true but less precise.
    withheld: SPECIAL_CLAIMS.map((c) => ({
      label: CLAIM_DEFS[c].label,
      basis: `${SENSITIVITY_LABEL[CLAIM_DEFS[c].sensitivity]}，無論委託人是否同意都不會給出去`,
    })),
  };
}

/** The persona's standing facts, independent of how the request was phrased. */
function DECLARED_SITUATION(today: string) {
  return {
    movedRecently: false,
    childAgeMonths: childAgeMonthsAt(today),
    hasResidentialMeter: PERSONA_DECLARED.hasResidentialMeter,
  };
}

export function runTurn(
  state: DemoState,
  utterance: string,
  resolved?: { intent: Intent; movedRecently: boolean } | null,
): TurnResult {
  const message = utterance.trim();
  const today = effectiveToday(state);
  // Never trust a caller-supplied intent blindly: an unknown label falls back
  // to the patterns rather than dropping through to whatever branch is last.
  const supplied =
    resolved && INTENT_VALUES.includes(resolved.intent) ? resolved : null;
  const intent = supplied?.intent ?? intentOf(message);

  if (intent === "privacy") {
    return {
      programs: [],
      matched: true,
      outputs: [
        {
          text: "機關拿到的是述詞，不是原始欄位。下面是每個補助各自會收到什麼，以及有哪些欄位不論你同不同意都不會給出去。",
        },
        claimsExplainer(),
        { suggestions: MENU.suggestions },
      ],
    };
  }

  if (intent === "audit") {
    return {
      programs: [],
      matched: true,
      outputs: [
        { text: "每一次核准、發證、兌現、送件與拒絕都留了紀錄。稽核只記動作，不含金庫值。" },
        { auditTrail: true },
        { suggestions: MENU.suggestions },
      ],
    };
  }

  if (intent === "status") {
    const live = state.grants.map((g) => g.body.purpose);
    if (!live.length) {
      return {
        programs: [],
        matched: true,
        outputs: [
          { text: "目前還沒有任何申請案。先跟我說你的情況，我才知道要比對什麼。" },
          { suggestions: MENU.suggestions },
        ],
      };
    }
    return {
      programs: [],
      matched: true,
      outputs: [
        { text: "目前的進度如下。送件之後的階段本演示沒有接真實機關，不會亮起。" },
        ...live.map((purpose) => ({ purpose })),
      ],
    };
  }

  if (intent === "revoke") {
    return {
      programs: [],
      matched: true,
      outputs: [
        {
          text: "停止委託會讓我不能再簽任何新的匣，尚未兌現的也會一併作廢。已經交給機關的述詞收不回來——這點我不會假裝做得到。\n\n下面「我的委託設定」裡有停止的按鈕。",
        },
        { suggestions: MENU.suggestions },
      ],
    };
  }

  if (intent === "help" || intent === null) {
    return {
      programs: [],
      matched: false,
      outputs: [
        {
          text:
            intent === "help"
              ? "我用規則引擎比對你能辦什麼補助，然後把最小的授權匣交給你簽。我不決定授權，也簽不了名——私鑰在你的認證器裡。"
              : "我沒聽懂這句。我會的事情不多，但都做得準：",
        },
        { question: "你可以問我這些", suggestions: MENU.suggestions },
      ],
    };
  }

  // The classifier reports what was said; the rule engine decides what it means.
  // When it reported a move, build the situation from that rather than re-running
  // keyword matching over the same sentence — otherwise the patterns silently
  // overrule the thing that was brought in to understand phrasings they miss.
  const situation = supplied
    ? { ...DECLARED_SITUATION(today), movedRecently: supplied.movedRecently }
    : situationFromUtterance(message, today);

  if (!situation?.movedRecently) {
    return {
      programs: [],
      matched: false,
      outputs: [
        { text: "規則引擎沒有偵測到「搬家／遷徙」，所以沒有可以比對的情況變動。" },
        { question: "換個說法試試", suggestions: MENU.suggestions },
      ],
    };
  }

  const programs = matchPrograms(situation);
  const hint = ageHint(childAgeMonthsAt(today));

  if (!programs.length) {
    return {
      programs,
      matched: true,
      outputs: [{ text: `目前沒有符合的補助。${hint}` }],
    };
  }

  const outputs: unknown[] = [
    {
      text:
        programs.length > 1
          ? `比對到 ${programs.length} 項補助。每一項都要你單獨簽署一次——沒有「一次全給」。`
          : "比對到 1 項補助。",
    },
    {
      reasons: programs.flatMap((p) => [`${p.title}：${p.reasons.join("；")}`]),
      withheld: withheldFrom(programs),
      ageHint: hint,
    },
  ];

  // One signing card per programme, in the order the rule engine matched them.
  for (const program of programs) {
    outputs.push({ grantId: program.grantId });
  }

  // Where each application currently stands, once there is something to stand.
  for (const program of programs) {
    outputs.push({ purpose: program.purpose });
  }

  return { programs, matched: true, outputs };
}

/** Convenience for callers that want blocks directly. */
export function turnBlocks(state: DemoState, utterance: string): Block[] {
  return toBlocks(runTurn(state, utterance).outputs);
}
