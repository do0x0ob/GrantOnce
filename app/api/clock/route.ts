import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { proposeGrantsFromPlan } from "@/lib/authz";
import { evaluateInquiry } from "@/lib/inquiry";
import { ageHint, childAgeMonthsAt, effectiveToday } from "@/lib/rules";
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
    // Moving a virtual clock re-derives what is true, in both directions. Left
    // in place, 「幼兒已滿 2 歲」 would still be sitting there after the clock
    // went back to today. Acknowledged notices stay: those are the record that
    // the principal saw them.
    if (offset !== s.clockOffsetDays) {
      s.notifications = s.notifications.filter((n) => n.acknowledged);
    }
    s.clockOffsetDays = offset;
    const today = effectiveToday(s);
    const months = childAgeMonthsAt(today);

    if (s.plan) {
      const inquiry = evaluateInquiry(s.plan.utterance, today);
      if (inquiry.canIssue) {
        const programs = inquiry.programs;
        s.plan = { ...s.plan, matchedAt: new Date().toISOString() };
        // Re-propose from scratch: a changed situation means new claims, a new
        // jti and a fresh signature. Grants are never silently amended.
        s.grants = s.grants.filter((g) => programs.some((p) => p.grantId === g.id));
        // Notice first, then act. Proposing before the watch pass would mean the
        // agent never got to say 「你現在符合托育補助」 — the capsule for it
        // would already exist, so the detector would have nothing to report.
        pushChanges(s, new Date());
        proposeGrantsFromPlan(s, programs);
        appendChat(
          s,
          "agent",
          offset === 0
            ? "時間已還原到演示基準日。"
            : `時間前進 ${offset} 天。${ageHint(months)}\n\n重新比對後，符合的申請案有 ${programs.length} 個。原本簽過的匣不會自動沿用——條件變了就要重新簽一張。`,
        );
      }
    }
  });

  return NextResponse.json(principalView(state));
}
