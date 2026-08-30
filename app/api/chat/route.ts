import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { toBlocks } from "@/lib/agent/blocks/of";
import {
  classify,
  shouldClassifyForChat,
  shouldResearchForChat,
} from "@/lib/agent/intent";
import { runTurn } from "@/lib/agent/turn";
import { confirmServiceRequest, openServiceRequests } from "@/lib/authz";
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

  // External work happens before the store lock. Classify first because public
  // research is a capability of benefit discovery, not a side effect of every
  // sentence: 「你是誰」 must never become a Wikipedia search.
  const resolved = shouldClassifyForChat(message) ? await classify(message) : null;
  const world = shouldResearchForChat(message, resolved)
    ? await researchWorld(message)
    : undefined;

  const state = mutate((s) => {
    appendChat(s, "user", message);

    // The rule engine runs first and the store is moved before the blocks are
    // assembled, so a card always names something that already exists.
    const turn = runTurn(s, message, { today: effectiveToday(s), world, resolved });

    // Stage 2: the matched services state what they need. No capsule yet.
    if (turn.programs.length) {
      s.plan = { utterance: message, matchedAt: new Date().toISOString() };
      openServiceRequests(s, turn.programs);
    }

    // Stages 3–4: only now, and only for what the person confirmed, does the
    // registry and 個資法 check run and a signable capsule appear.
    for (const requestId of turn.confirms) confirmServiceRequest(s, requestId);

    const blocks = toBlocks(turn.outputs);
    const text = blocks
      .filter((b) => b.kind === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n\n");
    appendChat(s, "agent", text, blocks);

    pushChanges(s, new Date());
  });

  return NextResponse.json(principalView(state));
}
