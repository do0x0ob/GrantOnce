import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { toBlocks } from "@/lib/agent/blocks/of";
import { classify } from "@/lib/agent/intent";
import { runTurn } from "@/lib/agent/turn";
import { proposeGrantsFromPlan } from "@/lib/authz";
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

  // Both reach outside the process, so both happen before the store is touched:
  // a slow lookup or a hanging router must never hold the lock. They are
  // independent, so they run together rather than in series.
  //
  // Understanding is the classifier's job. Keyword matching used to run
  // afterwards and silently overrule phrasings the model had already heard,
  // so a miss or a missing router now means "not understood", not a regex guess.
  const [world, resolved] = await Promise.all([researchWorld(message), classify(message)]);

  const state = mutate((s) => {
    appendChat(s, "user", message);

    // The rule engine runs first and grants are proposed before the blocks are
    // assembled, so a signing card always names a grant that already exists.
    const turn = runTurn(s, message, { today: effectiveToday(s), world, resolved });
    if (turn.programs.length) {
      s.plan = { utterance: message, matchedAt: new Date().toISOString() };
      proposeGrantsFromPlan(s, turn.programs);
    }

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
