import { pushChanges } from "@/lib/agent";
import { openServiceRequests } from "@/lib/authz";
import { evaluateInquiry } from "@/lib/inquiry";
import { ageHint, childAgeMonthsAt, effectiveToday } from "@/lib/rules";
import { appendChat } from "@/lib/store";
import type { DemoState } from "@/lib/types";

/**
 * Move the demo clock and re-derive what is true.
 *
 * Lives here rather than inline in the route because what happens when time
 * passes is a rule — which requirements re-open, whether anything is minted,
 * which notices survive — and rules in a route handler are rules nothing guards.
 */
export function shiftClock(state: DemoState, offsetDays: number): void {
  const offset = Math.max(0, Math.min(3650, Math.floor(offsetDays)));

  // Re-derives in both directions. Left in place, 「幼兒已滿 2 歲」 would still be
  // sitting there after the clock went back to today. Acknowledged notices stay:
  // those are the record that the principal saw them.
  if (offset !== state.clockOffsetDays) {
    state.notifications = state.notifications.filter((n) => n.acknowledged);
  }
  state.clockOffsetDays = offset;

  if (!state.plan) return;
  const today = effectiveToday(state);
  const inquiry = evaluateInquiry(state.plan.utterance, today);
  if (!inquiry.canIssue) return;

  const programs = inquiry.programs;
  state.plan = { ...state.plan, matchedAt: new Date().toISOString() };
  // Re-propose from scratch: a changed situation means new claims, a new jti and
  // a fresh signature. Grants are never silently amended.
  state.grants = state.grants.filter((g) => programs.some((p) => p.grantId === g.id));
  // Notice first, then act. Acting before the watch pass would mean the agent
  // never got to say 「你現在符合托育補助」 — the requirement for it would already
  // exist, so the detector would have nothing to report.
  pushChanges(state, new Date());
  // Time passing re-opens the requirements; it does not mint. A capsule that
  // appeared because the calendar moved would be an authorisation nobody gave.
  openServiceRequests(state, programs);

  appendChat(
    state,
    "agent",
    offset === 0
      ? "時間已還原到演示基準日。"
      : `時間前進 ${offset} 天。${ageHint(childAgeMonthsAt(today))}\n\n重新比對後，符合的申請案有 ${programs.length} 個。原本簽過的匣不會自動沿用——條件變了就要重新確認、重新簽一張。`,
  );
}
