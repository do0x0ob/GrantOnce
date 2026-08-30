import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { proposeGrantsFromPlan } from "@/lib/authz";
import { evaluateInquiry, formatInquiryMessage } from "@/lib/inquiry";
import { researchWorld } from "@/lib/research";
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

  const world = await researchWorld(message);

  const state = mutate((s) => {
    appendChat(s, "user", message);
    const today = effectiveToday(s);
    const inquiry = evaluateInquiry(message, today);
    appendChat(s, "agent", formatInquiryMessage(inquiry, today, world));

    if (!inquiry.canIssue) return;

    s.plan = { utterance: message, matchedAt: new Date().toISOString() };
    proposeGrantsFromPlan(s, inquiry.programs);
    pushChanges(s, new Date());
  });

  return NextResponse.json(principalView(state));
}
