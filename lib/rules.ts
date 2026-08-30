import { searchCatalog, topicsFromUtterance } from "./catalog";
import { ageBandOf, CLAIM_DEFS, DEMO_TODAY, monthsBetween, type ClaimId } from "./claims";
import { PURPOSES, type PurposeId } from "./purposes";
import type { ApplicationStatus, DemoState, NotificationDraft, ProgramPlan } from "./types";

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

/**
 * Wall-clock now, shifted by the demo clock.
 *
 * The offset simulates calendar time, so anything measured in days — credential
 * lifetimes, the child's age band — must move with it. A capsule's own expiry is
 * measured in seconds of the current session and deliberately does not, or
 * winding the clock forward would kill a grant the presenter just signed.
 */
export function effectiveNow(state: DemoState): Date {
  return new Date(Date.now() + (state.clockOffsetDays ?? 0) * 86_400_000);
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
/**
 * What the agency still needs, after subtracting what it already holds.
 *
 * The registry's `allowedClaims` is a ceiling — the most this purpose may ever
 * ask for. Handing that same list over every time is not minimisation, it is a
 * well-chosen maximum; the agency should be asking for the least it needs *this
 * time*, which is what makes 免重複繳交 real rather than a slogan.
 *
 * Holdings count only within the same purpose. Reusing what 甲 collected for
 * 育兒津貼 to save a step in 托育補助 would be 特定目的外之利用 under 個資法
 * §16 — a different question, and not one a convenience feature gets to answer.
 *
 * A claim ages out on its own `ttlDays`, so a stale copy is re-requested rather
 * than silently relied on.
 */
function stillNeeded(
  state: DemoState,
  purpose: PurposeId,
  ceiling: ClaimId[],
  now: Date,
): { claims: ClaimId[]; alreadyHeld: ClaimId[] } {
  const inbox = state.inboxes[purpose];
  const held = new Set(
    (inbox?.claims ?? [])
      .filter((delivered) => {
        const def = CLAIM_DEFS[delivered.claimId];
        if (!def) return false;
        const age = now.getTime() - new Date(delivered.receivedAt).getTime();
        return age < def.ttlDays * 86400000;
      })
      .map((delivered) => delivered.claimId),
  );
  const alreadyHeld = ceiling.filter((id) => held.has(id));
  return { claims: ceiling.filter((id) => !held.has(id)), alreadyHeld };
}

/** Re-ask each matched programme for the least it needs right now. */
export function narrowToStillNeeded(
  state: DemoState,
  programs: ProgramPlan[],
  now: Date,
): ProgramPlan[] {
  return programs.map((program) => ({
    ...program,
    ...stillNeeded(state, program.purpose, program.ceiling, now),
  }));
}

export function matchPrograms(situation: DeclaredSituation): ProgramPlan[] {
  const programs: ProgramPlan[] = [];
  const band = ageBandOf(situation.childAgeMonths);

  // `wantsX` narrows to what was asked for; a bare move leaves both true, so a
  // generic question still lists everything. Eligibility itself is on facts:
  // having moved is evidence the agency receives as a claim, not a precondition
  // for the programme, and gating on it meant someone who simply named the
  // benefit was told no.
  if (situation.wantsChildcare && band === "0-2") {
    const purpose = PURPOSES["childcare-allowance"];
    programs.push({
      grantId: purpose.slot,
      purpose: purpose.id,
      title: purpose.title,
      agencyId: purpose.agency,
      agencyName: `甲｜${purpose.agencyName}`,
      reasons: [
        "剛完成遷徙，戶籍已從臺北市改到新北市",
        "家中幼兒落在 0–2 歲育兒津貼年齡帶",
      ],
      claims: [...purpose.allowedClaims],
      ceiling: [...purpose.allowedClaims],
      alreadyHeld: [],
      hint: "滿 2 歲後改適用「未滿 5 歲幼兒托育補助」，屆時要換一張新的匣",
    });
  }

  // Gated the same way as 育兒津貼: the principal has to have asked about
  // childcare (or declared a move, which bundles the profile) before the rule
  // engine offers them the programme the child has aged into.
  if (situation.wantsChildcare && band === "2-5") {
    const purpose = PURPOSES["childcare-service-subsidy"];
    programs.push({
      grantId: purpose.slot,
      purpose: purpose.id,
      title: purpose.title,
      agencyId: purpose.agency,
      agencyName: `甲｜${purpose.agencyName}`,
      reasons: [
        "設籍新北市，且具法定親子關係",
        "幼兒已離開育兒津貼的年齡帶，落在托育補助的適用範圍",
      ],
      claims: [...purpose.allowedClaims],
      ceiling: [...purpose.allowedClaims],
      alreadyHeld: [],
      hint: "與育兒津貼是不同的目的，述詞組合也不同——要另外簽一張匣",
    });
  }

  if (situation.wantsAircon && situation.hasResidentialMeter) {
    const purpose = PURPOSES["aircon-subsidy"];
    programs.push({
      grantId: purpose.slot,
      purpose: purpose.id,
      title: purpose.title,
      agencyId: purpose.agency,
      agencyName: `乙｜${purpose.agencyName}`,
      reasons: ["有住宅用電戶，可用用電級距證明居住事實"],
      claims: [...purpose.allowedClaims],
      ceiling: [...purpose.allowedClaims],
      alreadyHeld: [],
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

/** Kept as an alias: the detectors now produce whole notifications. */
export type PendingChange = NotificationDraft;

const DAY_MS = 86_400_000;
/** A credential or a delegation this close to lapsing is worth mentioning. */
const EXPIRY_WARNING_MS = 7 * DAY_MS;
/** A signed capsule this close to its expiry will not survive a slow demo. */
const GRANT_WARNING_MS = 120_000;
/** A proposal left unsigned this long is waiting on the principal, not on us. */
const AWAITING_SIGNATURE_MS = 60_000;

function monthsUntilTwo(months: number): number {
  return 24 - months;
}

/**
 * The proactive half. Instead of waiting for the principal to re-ask, the agent
 * watches for the conditions that will change their entitlement and pushes.
 *
 * Pure: it reads `DemoState` and the clock, never the vault and never the model.
 *
 * Every draft carries two texts. `body` is for the principal and may name a
 * predicate value, because they are the one it is about. `summaryForAgent` is
 * what the model is allowed to read, and states what changed without ever
 * naming the value that changed — 「離開適用範圍」, not 「變成 2-6」.
 */
/**
 * Which application states are worth saying out loud, and how.
 *
 * Not every state is news. 「審核中」is what already happens after 已送件, so
 * announcing it would train the reader to ignore the channel — the three here
 * are the ones that either need something from them or end the wait.
 */
const PROGRESS_NOTICES: Partial<
  Record<
    ApplicationStatus,
    {
      kind: NotificationDraft["kind"];
      severity: NotificationDraft["severity"];
      label: string;
      title: string;
      body: string;
    }
  >
> = {
  "needs-more": {
    kind: "denial-followup",
    severity: "action-required",
    label: "需補件",
    title: "：機關說還缺東西",
    body: "機關把案件退回補件。補件要交什麼由機關那一側決定；真的需要新的述詞時，會是一張新的匣讓你重新簽，舊的不會被沿用。",
  },
  approved: {
    kind: "info",
    severity: "info",
    label: "已核定",
    title: "：已核定",
    body: "機關已核定這件申請。這一格是演示用的狀態切換，不代表已經串接真實機關。",
  },
  paid: {
    kind: "info",
    severity: "info",
    label: "已撥款",
    title: "：已撥款",
    body: "機關已撥款，這件申辦到此結束。這一格是演示用的狀態切換，不代表已經串接真實機關。",
  },
};

export function scanForChanges(state: DemoState, now: Date): NotificationDraft[] {
  const today = effectiveToday(state);
  const months = childAgeMonthsAt(today);
  const out: NotificationDraft[] = [];
  const at = now.getTime();

  // --- eligibility ---------------------------------------------------------
  if (months >= 24) {
    out.push({
      key: "eligibility:aged-out:G-甲",
      kind: "eligibility-change",
      severity: "action-required",
      title: "育兒津貼資格已改變",
      body:
        "幼兒已滿 2 歲，離開 0-2 年齡帶。原「育兒津貼」匣宣告的年齡帶述詞已不再成立，該匣不對應正確的補助；需要重新比對並簽一張新的匣。",
      summaryForAgent:
        "幼兒年齡帶已離開育兒津貼的適用範圍，原匣不再對應正確的補助，需要重新比對。",
      grantId: PURPOSES["childcare-allowance"].slot,
      suggestedAction: {
        tool: "plan_applications",
        args: { utterance: state.plan?.utterance ?? HAPPY_PATH_UTTERANCE },
        label: "重新比對可申請的補助",
      },
      staleAfter: null,
    });
  } else if (monthsUntilTwo(months) <= 3) {
    const left = monthsUntilTwo(months);
    out.push({
      key: "eligibility:aging-soon:G-甲",
      kind: "eligibility-change",
      severity: "info",
      title: `再 ${left} 個月育兒津貼條件會變`,
      body: "幼兒即將滿 2 歲，屆時改適用未滿 5 歲幼兒托育補助，需要不同的述詞組合。先提醒，不預先取得任何資料。",
      summaryForAgent:
        "幼兒將在三個月內離開育兒津貼的適用範圍，屆時要改用另一組述詞。目前不需要動作。",
      grantId: PURPOSES["childcare-allowance"].slot,
      suggestedAction: null,
      // Stops being true the day the child turns two; the aged-out notice
      // takes over from here.
      staleAfter: monthsAfterBirth(24),
    });
  }

  // A matched programme with no capsule of its own is the one piece of good
  // news the watch loop can deliver: you have become eligible for something.
  // Only offered once the principal has actually engaged — before that there is
  // no declared situation to watch.
  if (state.plan || state.grants.length) {
    const situation = situationFromUtterance(
      state.plan?.utterance ?? HAPPY_PATH_UTTERANCE,
      today,
    );
    for (const program of situation ? matchPrograms(situation) : []) {
      if (state.grants.some((g) => g.id === program.grantId)) continue;
      out.push({
        key: `eligibility:gained:${program.purpose}`,
        kind: "eligibility-gained",
        severity: "action-required",
        title: `你現在符合「${program.title}」`,
        body: `規則引擎比對出新的適用補助：${program.title}（${program.agencyName}）。${program.reasons.join("；")}。要不要我提出一張新的匣？述詞只有 ${program.claims.length} 項，仍然不含姓名、地址或出生日期。`,
        summaryForAgent: `規則引擎比對出新的適用補助「${program.title}」，尚未提出對應的匣。`,
        grantId: program.grantId,
        suggestedAction: {
          tool: "plan_applications",
          args: { utterance: state.plan?.utterance ?? HAPPY_PATH_UTTERANCE },
          label: `提出「${program.title}」的匣`,
        },
        staleAfter: null,
      });
    }
  }

  // --- credentials ---------------------------------------------------------
  for (const cred of state.wallet) {
    if (cred.revoked) continue;
    const left = new Date(cred.expiresAt).getTime() - at;
    if (left <= 0) {
      out.push({
        key: `credential:expired:${cred.id}`,
        kind: "credential-expiry",
        severity: "action-required",
        title: `憑證已到期：${cred.label}`,
        body: `${cred.issuerName} 簽發的「${cred.label}」憑證已過期，下次申請需重新取得。`,
        summaryForAgent: `皮夾裡「${cred.label}」的憑證已到期，需要發證機構重新簽發才能再出示。`,
        grantId: null,
        suggestedAction: null,
        staleAfter: null,
      });
    } else if (left <= EXPIRY_WARNING_MS) {
      out.push({
        key: `credential:expiring:${cred.id}`,
        kind: "credential-expiring",
        severity: "info",
        title: `憑證即將到期：${cred.label}`,
        body: `${cred.issuerName} 簽發的「${cred.label}」憑證將在七天內到期。到期後要重新取得才能再出示。`,
        summaryForAgent: `皮夾裡「${cred.label}」的憑證將在七天內到期。`,
        grantId: null,
        suggestedAction: null,
        staleAfter: cred.expiresAt,
      });
    }
  }

  // --- capsules ------------------------------------------------------------
  for (const grant of state.grants) {
    const exp = new Date(grant.body.exp).getTime();
    const left = exp - at;
    if (grant.status === "signed" && left > 0 && left <= GRANT_WARNING_MS) {
      out.push({
        // The jti belongs in the key: capsule ids are reused across proposals,
        // so keying on the id alone would let an old notice suppress the new
        // capsule's own.
        key: `grant:expiring:${grant.id}:${grant.body.jti}`,
        kind: "grant-expiring",
        severity: "action-required",
        title: `匣 ${grant.id} 兩分鐘內到期`,
        body: `已簽署但尚未兌現的匣 ${grant.id} 即將逾效期。過期後要重新比對並重新簽一張，編號、效期與簽章都會換新。`,
        summaryForAgent: `已簽署未兌現的匣 ${grant.id} 即將逾效期，兌現要趕在到期前完成。`,
        grantId: grant.id,
        suggestedAction: {
          tool: "redeem_grant",
          args: { grantId: grant.id, agency: grant.body.aud },
          label: `由機關兌現匣 ${grant.id}`,
        },
        staleAfter: grant.body.exp,
      });
    }
    if (grant.status === "proposed" && at - new Date(grant.proposedAt).getTime() >= AWAITING_SIGNATURE_MS && left > 0) {
      out.push({
        key: `awaiting-sign:${grant.id}:${grant.body.jti}`,
        kind: "awaiting-signature",
        severity: "action-required",
        title: `匣 ${grant.id} 還在等你簽`,
        body: `匣 ${grant.id} 已提出但尚未簽署。代理人沒有私鑰，簽署一定要由你以生物辨識完成。`,
        summaryForAgent: `匣 ${grant.id} 仍在等委託人簽署；代理人無法代簽。`,
        grantId: grant.id,
        suggestedAction: {
          tool: "get_grant_for_signature",
          args: { grantId: grant.id },
          label: `看匣 ${grant.id} 要簽的內容`,
        },
        staleAfter: grant.body.exp,
      });
    }
  }

  // --- delegation ----------------------------------------------------------
  const delegationLeft = new Date(state.delegation.validUntil).getTime() - at;
  if (state.delegation.active && delegationLeft > 0 && delegationLeft <= EXPIRY_WARNING_MS) {
    out.push({
      key: "delegation:expiring",
      kind: "delegation-expiring",
      severity: "action-required",
      title: "委託即將到期",
      body: "這份委託將在七天內到期。到期後代理人不能再提出任何新的匣，既有未兌現的匣也會被擋下。",
      summaryForAgent: "委託將在七天內到期，之後任何兌現都會被擋下，需要委託人重新設定。",
      grantId: null,
      suggestedAction: null,
      staleAfter: state.delegation.validUntil,
    });
  }

  // --- agencies ------------------------------------------------------------
  //
  // Progress past 已送件 is the one thing the person cannot see coming: it
  // happens at the agency, on the agency's clock, while nobody is looking at
  // the screen. Every other detector watches the principal's own state; this
  // one watches the reply — which is the half of「主動推送」that was missing.
  for (const inbox of Object.values(state.inboxes)) {
    const notice = PROGRESS_NOTICES[inbox.applicationStatus];
    if (!notice || !inbox.statusChangedAt) continue;
    out.push({
      // Keyed by the moment it changed, like the denial notice below: advancing
      // and then coming back to the same status is a new thing to say, but
      // re-scanning the same state is not.
      key: `progress:${inbox.purpose}:${inbox.applicationStatus}:${inbox.statusChangedAt}`,
      kind: notice.kind,
      severity: notice.severity,
      title: `${inbox.programTitle}${notice.title}`,
      body: notice.body,
      summaryForAgent: `${inbox.programTitle}的申辦狀態變成「${notice.label}」。`,
      grantId: null,
      suggestedAction: null,
      staleAfter: null,
    });
  }

  for (const inbox of Object.values(state.inboxes)) {
    if (!inbox.lastDenial || !inbox.lastDeniedAt) continue;
    out.push({
      key: `denial:${inbox.agencyId}:${inbox.lastDeniedAt}`,
      kind: "denial-followup",
      severity: "risk",
      title: `${inbox.name} 上一次的請求被擋下`,
      body: `理由：${inbox.lastDenial}\n這筆請求沒有交付任何述詞。要繼續的話得重新比對，簽一張範圍正確的匣。`,
      summaryForAgent: `對 ${inbox.name} 的上一次請求遭攔截，沒有交付任何述詞，需要重新提案。`,
      grantId: null,
      suggestedAction: {
        tool: "plan_applications",
        args: { utterance: state.plan?.utterance ?? HAPPY_PATH_UTTERANCE },
        label: "重新比對後再提一張匣",
      },
      staleAfter: null,
    });
  }

  return out;
}

/** The instant the declared child reaches `months` months old, in ISO form. */
function monthsAfterBirth(months: number): string {
  const born = new Date(`${PERSONA_DECLARED.childBirthDate}T00:00:00Z`);
  const at = new Date(born);
  at.setUTCMonth(at.getUTCMonth() + months);
  return at.toISOString();
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
