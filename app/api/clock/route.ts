import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { proposeGrantsFromPlan } from "@/lib/authz";
import { ageHint, childAgeMonthsAt, effectiveToday, matchPrograms, situationFromUtterance } from "@/lib/rules";
import { appendChat, mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * Demo-only clock shift. Ages the child out of the 0–2 band on stage so the
 * dynamic re-authorisation is something you can watch rather than describe.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { offsetDays?: number };
  const offset = Math.max(0, Math.min(3650, Math.floor(body.offsetDays ?? 0)));

  const state = mutate((s) => {
    s.clockOffsetDays = offset;
    const today = effectiveToday(s);
    const months = childAgeMonthsAt(today);

    if (s.plan) {
      const situation = situationFromUtterance(s.plan.utterance, today);
      if (situation) {
        const programs = matchPrograms(situation);
        s.plan = { ...s.plan, matchedAt: new Date().toISOString() };
        // Re-propose from scratch: a changed situation means new claims, a new
        // jti and a fresh signature. Grants are never silently amended.
        s.grants = s.grants.filter((g) => programs.some((p) => p.grantId === g.id));
        proposeGrantsFromPlan(s, programs);
        pushChanges(s, new Date());
        appendChat(
          s,
          "agent",
          offset === 0
            ? "時間已還原到演示基準日。"
            : `時間前進 ${offset} 天。${ageHint(months)}\n\n重新比對後，符合的申請案剩下 ${programs.length} 個。原本簽過的匣不會自動沿用——條件變了就要重新簽一張。`,
        );
      }
    }
  });

  return NextResponse.json(principalView(state));
}
