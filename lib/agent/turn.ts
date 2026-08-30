import { CLAIM_DEFS, SENSITIVITY_LABEL, SPECIAL_CLAIMS } from "@/lib/claims";
import { PURPOSE_IDS, PURPOSES, type PurposeId } from "@/lib/purposes";
import {
  ageHint,
  childAgeMonthsAt,
  effectiveNow,
  effectiveToday,
  HAPPY_PATH_UTTERANCE,
  matchPrograms,
  narrowToStillNeeded,
  PERSONA_DECLARED,
  situationFromUtterance,
} from "@/lib/rules";
import type { DeclaredSituation } from "@/lib/rules";
import type { ResearchResult } from "@/lib/research";
import type { DemoState, ProgramPlan } from "@/lib/types";
import { SERVICE_REQUEST_LABEL } from "@/lib/view";
import { toBlocks } from "./blocks/of";
import type { Block } from "./blocks/types";
import {
  isAgentSkillAction,
  isAgentSkillId,
  type AgentSkillAction,
  type AgentSkillId,
} from "./skills";

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
  /**
   * Requirement ids the person just confirmed. The caller runs the registry and
   * 個資法 check and mints from these — never this function, which stays free of
   * side effects.
   */
  confirms: string[];
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
export type Intent = "apply" | "confirm" | "status" | "audit" | "privacy" | "revoke" | "help";

const INTENT_VALUES: Intent[] = ["apply", "confirm", "status", "audit", "privacy", "revoke", "help"];

const INTENT_PATTERNS: [Intent, RegExp][] = [
  ["status", /進度|到哪|辦得?怎麼樣|狀態|審核|送出了嗎|好了沒/],
  ["audit", /誰.*(拿|取|看|調)|稽核|紀錄|軌跡|查詢紀錄/],
  ["privacy", /所得|隱私|會拿到什麼|給什麼|哪些資料|個資|安全|健保/],
  ["revoke", /撤銷|取消|停止|不要了|收回/],
  ["confirm", /確認|同意這|就這樣|繼續|好，?(請|幫)?(繼續|準備|給我)|準備簽署|要簽/],
  ["apply", /搬家|遷徙|剛搬|搬到|遷入|申請|補助|津貼|能申|可以申|辦什麼/],
  ["help", /你是誰|你叫什麼|你是什麼|你會|能做什麼|怎麼用|說明|幫助|help/],
];

export function patternIntent(utterance: string): Intent | null {
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
    wantsChildcare: true,
    wantsAircon: true,
    childAgeMonths: childAgeMonthsAt(today),
    hasResidentialMeter: PERSONA_DECLARED.hasResidentialMeter,
  };
}

export type TurnContext = {
  today: string;
  /** Public search: what the outside world has, which is not the same question
   *  as what this runtime can issue. */
  world?: ResearchResult;
  resolved?: {
    intent: Intent;
    movedRecently: boolean;
    reply?: string;
    skill?: AgentSkillId;
    skillAction?: AgentSkillAction;
  } | null;
};

/**
 * The situation the rule engine judges, from the words plus the one thing the
 * classifier reports.
 *
 * Exported because the caller has to know whether the registry already answers
 * the question before deciding to spend a public search on it, and deriving the
 * situation twice in two places is how the two answers drift apart.
 */
export function situationFor(
  utterance: string,
  today: string,
  movedRecently: boolean | null,
): DeclaredSituation {
  const fromWords = situationFromUtterance(utterance, today) ?? DECLARED_SITUATION(today);
  return movedRecently === null ? fromWords : { ...fromWords, movedRecently };
}

export function runTurn(state: DemoState, utterance: string, ctx?: TurnContext): TurnResult {
  const message = utterance.trim();
  const today = ctx?.today ?? effectiveToday(state);
  const world = ctx?.world;
  const resolved = ctx?.resolved;
  // Never trust a caller-supplied intent blindly: an unknown label falls back
  // to the patterns rather than dropping through to whatever branch is last.
  const supplied =
    resolved && INTENT_VALUES.includes(resolved.intent) ? resolved : null;
  const selectedSkill =
    supplied && isAgentSkillId(supplied.skill) && isAgentSkillAction(supplied.skillAction)
      ? { id: supplied.skill, action: supplied.skillAction }
      : null;
  const intent = selectedSkill?.action === "plan"
    ? "apply"
    : (supplied?.intent ?? patternIntent(message));

  // The acknowledgement leads; everything the user needs to rely on follows it
  // as a card, so a missing or rejected sentence costs nothing.
  // Help has its own stable identity/capability copy below. Keeping a model
  // acknowledgement there produces two introductions for a question such as
  // 「你是誰」, so free prose is useful only on the other branches.
  const ack: unknown[] = supplied?.reply && intent !== "help" ? [{ text: supplied.reply }] : [];

  // What the outside world has is a separate question from what this runtime
  // can issue, so it renders as its own card rather than being folded into the
  // reply as prose.
  const researchLead: unknown[] = world && world.findings.length ? [{ research: world }] : [];
  const lead: unknown[] = [...researchLead, ...ack];

  // A skill may make the conversation more natural, but only `plan` crosses
  // into the deterministic proposal path. Explaining and clarifying are
  // deliberately read-only even if the coarse intent label was `apply`.
  if (selectedSkill?.id === "apply-with-grant" && selectedSkill.action !== "plan") {
    const fallback =
      selectedSkill.action === "explain"
        ? "我可以先說明補助差異、所需述詞與授權流程；只有你明確要開始比對時，才會準備授權匣。"
        : "你可以先了解流程，也可以直接開始資格比對。告訴我你想先了解哪一部分就好。";
    return {
      programs: [],
      matched: true,
      confirms: [],
      outputs: [
        ...researchLead,
        { text: fallback },
        { suggestions: MENU.suggestions },
      ],
    };
  }

  if (intent === "privacy") {
    return {
      programs: [],
      matched: true,
      confirms: [],
      outputs: [
        ...lead,
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
      confirms: [],
      outputs: [
        ...lead,
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
        confirms: [],
        outputs: [
          { text: "目前還沒有任何申請案。先跟我說你的情況，我才知道要比對什麼。" },
          { suggestions: MENU.suggestions },
        ],
      };
    }
    return {
      programs: [],
      matched: true,
      confirms: [],
      outputs: [
        ...lead,
        { text: "目前的進度如下。送件之後的階段本演示沒有接真實機關，不會亮起。" },
        ...live.map((purpose) => ({ purpose })),
      ],
    };
  }

  if (intent === "revoke") {
    return {
      programs: [],
      matched: true,
      confirms: [],
      outputs: [
        ...lead,
        {
          text: "停止委託後，這個流程不再接受新的簽署，尚未兌現的 Grant 也會一併作廢。已經交給機關的述詞收不回來——這點我不會假裝做得到。\n\n下面「我的委託設定」裡有停止的按鈕。",
        },
        { suggestions: MENU.suggestions },
      ],
    };
  }

  /**
   * Stage 3–4 — the person confirmed, so the check may now run.
   *
   * Gated on state, never on the classifier alone: 「好」 and 「可以」 are far too
   * cheap for a word to be the thing that mints an authorisation.
   */
  const pending = state.serviceRequests.filter((r) => r.status === "awaiting-confirmation");
  if (intent === "confirm") {
    if (!pending.length) {
      return {
        programs: [],
        matched: true,
        confirms: [],
        outputs: [
          ...lead,
          { text: "目前沒有等你確認的服務需求。要先看看你符合哪些補助嗎？" },
          { suggestions: MENU.suggestions },
        ],
      };
    }

    // Naming one confirms that one. The fallback to "the only one open" applies
    // only when nothing was named at all — otherwise saying 「確認育兒津貼」 once
    // it is already signed would confirm whatever else happened to be left open,
    // which is precisely the handed-a-capsule-you-did-not-name failure.
    const mentioned = state.serviceRequests.filter((r) => message.includes(r.title));
    const namedPending = pending.filter((r) => message.includes(r.title));
    const chosen = namedPending.length
      ? namedPending
      : mentioned.length
        ? []
        : pending.length === 1
          ? pending
          : [];

    if (!chosen.length && mentioned.length) {
      const already = mentioned.map((r) => `${r.title}：${SERVICE_REQUEST_LABEL[r.status]}`);
      return {
        programs: [],
        matched: true,
        confirms: [],
        outputs: [
          ...lead,
          { text: `這一項不在等待確認的狀態。\n\n${already.join("\n")}` },
          { suggestions: MENU.suggestions },
        ],
      };
    }

    if (!chosen.length) {
      return {
        programs: [],
        matched: true,
        confirms: [],
        outputs: [
          ...lead,
          { text: `有 ${pending.length} 項需求在等你確認。要先送哪一項去做目的與法源檢查？` },
          {
            question: "選一項",
            options: pending.map((r) => ({
              purpose: r.purpose,
              title: r.title,
              detail: `${r.requesterName}：${r.claims.length} 項述詞`,
            })),
          },
        ],
      };
    }

    const outputs: unknown[] = [
      ...lead,
      {
        text:
          chosen.length > 1
            ? `已確認 ${chosen.length} 項需求。現在才做目的與法源檢查——先看機關有沒有權力要這些，通過了才鑄出你要簽的匣。`
            : `已確認「${chosen[0].title}」。現在才做目的與法源檢查——先看機關有沒有權力要這些，通過了才鑄出你要簽的匣。`,
      },
    ];
    for (const request of chosen) outputs.push({ legalCheck: request.purpose });
    for (const request of chosen) outputs.push({ grantId: PURPOSES[request.purpose].slot });
    for (const request of chosen) outputs.push({ purpose: request.purpose });

    return { programs: [], matched: true, confirms: chosen.map((r) => r.id), outputs };
  }

  if (intent === "help" || intent === null) {
    return {
      programs: [],
      matched: false,
      confirms: [],
      outputs: [
        ...lead,
        {
          text:
            intent === "help"
              ? "我是 GrantOnce 的服務申請助手。我會找已登記服務、顯示本次必要資料並追蹤進度。你簽署後，資料來源才直接交付辦理機關；我不代簽，也不取得資料值。"
              : "我沒聽懂這句。我會的事情不多，但都做得準：",
        },
        { question: "你可以問我這些", suggestions: MENU.suggestions },
      ],
    };
  }

  // The classifier reports what was said; the rule engine decides what it means.
  //
  // It reports exactly one thing — whether a move was described — because it is
  // there to read phrasings the patterns miss. It says nothing about which
  // benefit was named, so that narrowing still has to come from the words. Taking
  // the whole situation from the classifier's branch dropped it: with a router
  // configured, 「要搞育兒津貼」 came back with 冷氣汰換補助 attached, which is the
  // agent deciding on your behalf what else to authorise.
  const situation = situationFor(message, today, supplied?.movedRecently ?? null);

  // Eligibility is judged on facts alone — what this person qualifies for,
  // regardless of which benefit they happened to name. Narrowing comes after,
  // so the reply can say "you also qualify for X, but you did not ask".
  const eligible = matchPrograms({ ...situation, wantsChildcare: true, wantsAircon: true });
  const hint = ageHint(childAgeMonthsAt(today));

  // Naming a benefit narrows the answer to it. Being handed a capsule for
  // 冷氣汰換補助 when you asked about 育兒津貼 is the agent deciding on your
  // behalf what else to authorise, which is the whole thing this is against.
  // A bare move leaves both `wants` flags true, so a generic question still
  // lists everything.
  const named: PurposeId[] = PURPOSE_IDS.filter((id) => {
    if (id === "childcare-allowance" || id === "childcare-service-subsidy") {
      return situation.wantsChildcare;
    }
    return id === "aircon-subsidy" && situation.wantsAircon;
  });
  const narrowed = named.length < PURPOSE_IDS.length;
  const matched = narrowed
    ? eligible.filter((program) => named.includes(program.purpose))
    : eligible;

  // The agency asks for the least it needs right now, not for its registry
  // ceiling. Anything it already holds for this same purpose, still within that
  // claim's own lifetime, is not requested again.
  // Holdings age in days, so they follow the demo clock like everything else
  // measured in days. Using the wall clock here meant fast-forwarding a year
  // still left every delivered claim looking fresh.
  const programs = narrowToStillNeeded(state, matched, effectiveNow(state));

  // Asked about something no registered purpose covers. Not the same as being
  // ineligible, and saying 「目前不符合」 with nothing after it — which is what an
  // empty `named` used to produce — tells the person their circumstances are the
  // problem when the truth is that this runtime has no adapter for what they
  // asked about.
  if (!named.length && !situation.movedRecently) {
    return {
      programs: [],
      matched: true,
      confirms: [],
      outputs: [
        ...lead,
        {
          text: eligible.length
            ? `這個服務沒有登記在本系統，所以發不出授權匣——缺的是綁定，不是世界上沒有這筆補助。\n\n已登記而且你目前符合的是：${eligible
                .map((p) => p.title)
                .join("、")}。要看嗎？`
            : "這個服務沒有登記在本系統，所以發不出授權匣——缺的是綁定，不是世界上沒有這筆補助。",
        },
        { suggestions: MENU.suggestions },
      ],
    };
  }

  // Named a registered benefit but not currently eligible: say which, and what is.
  if (narrowed && !programs.length && eligible.length) {
    const asked = named.map((id) => PURPOSES[id].title).join("、");
    return {
      programs: [],
      matched: true,
      confirms: [],
      outputs: [
        ...lead,
        {
          text: `目前不符合${asked}。${hint}\n\n符合的是：${eligible
            .map((p) => p.title)
            .join("、")}。要看嗎？`,
        },
        { suggestions: MENU.suggestions },
      ],
    };
  }

  // Everything this purpose could need is already with the agency and current, so
  // there is nothing left to authorise. The strongest possible outcome of
  // minimisation, and it has to be sayable rather than looking like a failure.
  const settled = programs.filter((program) => !program.claims.length);
  if (settled.length && settled.length === programs.length) {
    return {
      programs: [],
      matched: true,
      confirms: [],
      outputs: [
        ...lead,
        {
          text: `${settled
            .map((p) => p.title)
            .join("、")}：${settled[0].agencyName.replace(/^[甲乙丙]｜/, "")}已經持有本次所需的全部述詞，而且都還在效期內。這次不需要你再授權任何東西。`,
        },
        { suggestions: MENU.suggestions },
      ],
    };
  }

  if (!programs.length) {
    return {
      programs,
      matched: true,
      confirms: [],
      outputs: [...lead, { text: `目前沒有符合的補助。${hint}` }, { suggestions: MENU.suggestions }],
    };
  }

  const outputs: unknown[] = [
    ...lead,
    {
      text:
        programs.length > 1
          ? `找到 ${programs.length} 項已登記服務，各自回傳了本次必要資料。你確認哪一項，我才把哪一項送去做目的與法源檢查；現在還沒有任何可簽署的匣。`
          : narrowed && eligible.length > 1
            ? `只準備了${programs[0].title}這一張。你其實也符合${eligible
                .filter((p) => p.purpose !== programs[0].purpose)
                .map((p) => p.title)
                .join("、")}，但你沒提，我就不會替你要。`
            : "找到 1 項已登記服務。服務已回傳本次必要資料，現在等你確認。",
    },
    {
      reasons: programs.flatMap((p) => [`${p.title}：${p.reasons.join("；")}`]),
      withheld: withheldFrom(programs),
      ageHint: hint,
    },
  ];

  // The turn stops at the requirement. Nothing is minted and nothing is
  // signable until the person says yes — that confirmation is stage 2, and
  // fusing it with the signing card is what made the flow feel back to front.
  for (const program of programs) {
    outputs.push({ serviceRequirement: program.purpose });
  }

  outputs.push({
    question:
      programs.length > 1
        ? "要我把哪一項送去做目的與法源檢查？"
        : "要送去做目的與法源檢查嗎？",
    suggestions: programs.map((program) => ({
      label: `確認「${program.title}」的資料需求`,
      utterance: `確認${program.title}的資料需求`,
    })),
  });

  // Where each application currently stands, once there is something to stand.
  for (const program of programs) {
    outputs.push({ purpose: program.purpose });
  }

  return { programs, matched: true, outputs, confirms: [] };
}

/** Convenience for callers that want blocks directly. */
export function turnBlocks(state: DemoState, utterance: string): Block[] {
  return toBlocks(runTurn(state, utterance).outputs);
}
