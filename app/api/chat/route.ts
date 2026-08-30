import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { toBlocks } from "@/lib/agent/blocks/of";
import {
  classify,
  shouldClassifyForChat,
  shouldResearch,
} from "@/lib/agent/intent";
import { runTurn } from "@/lib/agent/turn";
import { applyTurn } from "@/lib/agent/apply";
import { researchWorld } from "@/lib/research";
import { effectiveToday } from "@/lib/rules";
import { appendChat, getState, mutate } from "@/lib/store";
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

  const world = shouldResearch(getState(), message, resolved)
    ? await researchWorld(message)
    : undefined;

  const state = mutate((s) => {
    appendChat(s, "user", message);

    // The rule engine runs first and the store is moved before the blocks are
    // assembled, so a card always names something that already exists.
    const turn = runTurn(s, message, { today: effectiveToday(s), world, resolved });

    // A requirement is opened only for a service the person actually picked.
    // Opening one for everything that matched left records behind for services
    // nobody chose, and made the first reply a wall of cards.
    applyTurn(s, message, turn);

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
