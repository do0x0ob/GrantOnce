import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { proposeGrantsFromPlan } from "@/lib/authz";
import { evaluateInquiry, formatInquiryMessage } from "@/lib/inquiry";
import { effectiveToday } from "@/lib/rules";
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
    const inquiry = evaluateInquiry(message, today);
    appendChat(s, "agent", formatInquiryMessage(inquiry, today));

    if (!inquiry.canIssue) return;

    s.plan = { utterance: message, matchedAt: new Date().toISOString() };
    proposeGrantsFromPlan(s, inquiry.programs);
    pushChanges(s, new Date());
  });

  return NextResponse.json(principalView(state));
}
