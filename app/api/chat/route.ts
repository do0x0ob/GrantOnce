import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { proposeGrantsFromPlan } from "@/lib/authz";
import { CLAIM_DEFS } from "@/lib/claims";
import { PURPOSES } from "@/lib/purposes";
import {
  ageHint,
  childAgeMonthsAt,
  effectiveToday,
  AGENT_NOTES,
  HAPPY_PATH_UTTERANCE,
  matchPrograms,
  situationFromUtterance,
} from "@/lib/rules";
import { appendChat, mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "請輸入訊息" }, { status: 400 });
  }

  const state = mutate((s) => {
    appendChat(s, "user", message);
    const today = effectiveToday(s);
    const situation = situationFromUtterance(message, today);

    if (!situation) {
      appendChat(
        s,
        "agent",
        `這個演示只處理補助比對。請輸入：「${HAPPY_PATH_UTTERANCE}」\n\n資格由規則引擎決定，模型不決定授權。`,
      );
      return;
    }
    if (!situation.movedRecently) {
      appendChat(
        s,
        "agent",
        "規則引擎沒有偵測到「搬家／遷徙」。快樂路徑請用：「我剛搬家，看我能申請什麼。」",
      );
      return;
    }

    const programs = matchPrograms(situation);
    const hint = ageHint(childAgeMonthsAt(today));
    s.plan = { utterance: message, matchedAt: new Date().toISOString() };
    proposeGrantsFromPlan(s, programs);

    if (!programs.length) {
      appendChat(s, "agent", `目前沒有符合的補助。${hint}`);
      return;
    }

    const lines = [
      "規則引擎比對結果（非模型授權）：",
      "",
      ...programs.flatMap((p, i) => {
        const purpose = PURPOSES[p.purpose];
        return [
          `${i + 1}. ${p.title} — ${p.agencyName}`,
          `   原因：${p.reasons.join("；")}`,
          `   本匣述詞：${p.claims.map((c) => CLAIM_DEFS[c].label).join("、")}`,
          `   個資依據：${purpose.privacyBasis[0]}`,
          p.hint ? `   提示：${p.hint}` : "",
        ];
      }),
      "",
      hint,
      "",
      "",
      ...AGENT_NOTES,
    ].filter(Boolean);

    appendChat(s, "agent", lines.join("\n"));

    pushChanges(s, new Date());
  });

  return NextResponse.json(principalView(state));
}
